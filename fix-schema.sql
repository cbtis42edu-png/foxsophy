-- Revisa y corrige el esquema real de Supabase para que coincida con la app

-- 1) Grupos: necesita owner_id
alter table public.groups
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists groups_owner_created_idx
  on public.groups(owner_id, created_at desc);

-- 2) Students: tabla base
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  real_name text not null,
  alias text not null,
  created_at timestamptz not null default now()
);

create index if not exists students_group_id_idx
  on public.students(group_id);

-- 3) Questions: tabla base
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  rubric text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists questions_group_active_idx
  on public.questions(group_id, active, created_at desc);

-- 4) Answers: columnas requeridas por la app
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  parent_answer_id uuid references public.answers(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  likes_by uuid[] not null default '{}',
  score integer check (score between 1 and 10),
  teacher_score integer check (teacher_score between 1 and 10),
  feedback text,
  created_at timestamptz not null default now()
);

alter table public.answers
  add column if not exists parent_answer_id uuid references public.answers(id) on delete cascade;

alter table public.answers
  add column if not exists likes_by uuid[] not null default '{}';

alter table public.answers
  add column if not exists score integer;

alter table public.answers
  add column if not exists teacher_score integer;

alter table public.answers
  add column if not exists feedback text;

create index if not exists answers_question_created_idx
  on public.answers(question_id, created_at desc);

create index if not exists answers_parent_answer_idx
  on public.answers(parent_answer_id);

-- 5) Ajuste de constraints para score / teacher_score
alter table public.answers drop constraint if exists answers_score_check;
alter table public.answers add constraint answers_score_check
  check (score is null or score between 1 and 10);

alter table public.answers drop constraint if exists answers_teacher_score_check;
alter table public.answers add constraint answers_teacher_score_check
  check (teacher_score is null or teacher_score between 1 and 10);

-- 6) Función de likes
create or replace function public.toggle_answer_like(p_answer_id uuid, p_student_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_likes uuid[];
begin
  update public.answers
  set likes_by = case
      when p_student_id = any(likes_by) then array_remove(likes_by, p_student_id)
      else array_append(likes_by, p_student_id)
    end
  where id = p_answer_id
  returning likes_by into updated_likes;

  if updated_likes is null then
    raise exception 'Answer not found';
  end if;

  return cardinality(updated_likes);
end;
$$;

revoke all on function public.toggle_answer_like(uuid, uuid) from public, anon, authenticated;
grant execute on function public.toggle_answer_like(uuid, uuid) to service_role;

-- 7) RLS
alter table public.groups enable row level security;
alter table public.students enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;

-- 8) Si tienes grupos antiguos sin owner_id, asócialos al docente correcto
-- update public.groups
-- set owner_id = 'UUID-DEL-DOCENTE'
-- where id = 'UUID-DEL-GRUPO';
