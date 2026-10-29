import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { containsProfanity } from "@/lib/moderation";
import { getSupabaseAdmin, getSupabaseAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const teacherCookie = "aula_teacher";
const studentCookie = "aula_student";
const cookieLifetime = 60 * 60 * 24 * 7;

function signature(value: string) {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update(value).digest("hex");
}
function teacherCookieValue(userId: string) {
  const payload = `${userId}.${Date.now() + cookieLifetime * 1000}`;
  return `${payload}.${signature(`teacher:${payload}`)}`;
}
function teacherIdFromSession(request: NextRequest) {
  if (studentIdFromSession(request)) return null;
  const value = request.cookies.get(teacherCookie)?.value;
  if (!value) return null;
  const signatureSeparator = value.lastIndexOf(".");
  if (signatureSeparator < 1) return null;
  const payload = value.slice(0, signatureSeparator);
  const payloadSeparator = payload.lastIndexOf(".");
  if (payloadSeparator < 1) return null;
  const userId = payload.slice(0, payloadSeparator);
  const expiry = payload.slice(payloadSeparator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return null;
  const supplied = Buffer.from(value.slice(signatureSeparator + 1));
  const expected = Buffer.from(signature(`teacher:${payload}`));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? userId : null;
}
function studentIdFromSession(request: NextRequest) {
  const value = request.cookies.get(studentCookie)?.value;
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const payloadSeparator = payload.lastIndexOf(".");
  if (payloadSeparator < 1) return null;
  const studentId = payload.slice(0, payloadSeparator);
  const expiry = payload.slice(payloadSeparator + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return null;
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signature(`student:${payload}`));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return studentId;
}
function jsonError(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
async function teacherOwnsGroup(supabase: ReturnType<typeof getSupabaseAdmin>, ownerId: string, groupId: string) {
  const { data, error } = await supabase.from("groups").select("id").eq("id", groupId).eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
async function teacherOwnsQuestion(supabase: ReturnType<typeof getSupabaseAdmin>, ownerId: string, questionId: string) {
  const { data: question, error } = await supabase.from("questions").select("group_id").eq("id", questionId).maybeSingle();
  if (error) throw error;
  return question ? teacherOwnsGroup(supabase, ownerId, question.group_id) : false;
}
async function teacherOwnsAnswer(supabase: ReturnType<typeof getSupabaseAdmin>, ownerId: string, answerId: string) {
  const { data: answer, error } = await supabase.from("answers").select("question_id").eq("id", answerId).maybeSingle();
  if (error) throw error;
  return answer ? teacherOwnsQuestion(supabase, ownerId, answer.question_id) : false;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const view = request.nextUrl.searchParams.get("view");
    if (view === "groups") {
      const teacherId = teacherIdFromSession(request);
      if (!teacherId) return jsonError("Inicia sesión con tu cuenta docente.", 401);
      const { data, error } = await supabase.from("groups").select("id, name, code, created_at").eq("owner_id", teacherId).order("created_at", { ascending: false });
      if (error) throw error;
      return NextResponse.json({ groups: data });
    }
    if (view === "group") {
      const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase();
      if (!code) return jsonError("Escribe el código del grupo.");
      const { data: group, error: groupError } = await supabase.from("groups").select("id, name, code, owner_id").eq("code", code).maybeSingle();
      if (groupError) throw groupError;
      if (!group) return jsonError("No encontramos ese grupo.", 404);
      const teacherId = teacherIdFromSession(request);
      const teacher = Boolean(teacherId);
      if (teacherId && group.owner_id !== teacherId) return jsonError("Este grupo pertenece a otra cuenta docente.", 403);
      const studentId = studentIdFromSession(request);
      if (!teacher) {
        if (!studentId) return jsonError("Entra al grupo para consultar su contenido.", 401);
        const { data: member, error: memberError } = await supabase.from("students").select("group_id").eq("id", studentId).maybeSingle();
        if (memberError) throw memberError;
        if (!member || member.group_id !== group.id) return jsonError("Solo puedes consultar tu grupo.", 403);
      }
      let query = supabase.from("questions").select("id, text, active, rubric, created_at").eq("group_id", group.id).order("created_at", { ascending: false });
      if (!teacher) query = query.eq("active", true);
      const { data: questions, error: questionError } = await query;
      if (questionError) throw questionError;
      const questionIds = (questions ?? []).map((question) => question.id);
      const answerResult = questionIds.length
        ? await supabase.from("answers").select("id, question_id, student_id, parent_answer_id, body, likes_by, score, teacher_score, feedback, created_at").in("question_id", questionIds).order("created_at", { ascending: false })
        : { data: [], error: null };
      if (answerResult.error) throw answerResult.error;
      const answers = answerResult.data ?? [];
      const studentIds = Array.from(new Set(answers.map((answer) => answer.student_id)));
      const studentResult = studentIds.length ? await supabase.from("students").select("id, alias").in("id", studentIds) : { data: [], error: null };
      if (studentResult.error) throw studentResult.error;
      const aliases = new Map((studentResult.data ?? []).map((student) => [student.id, student.alias]));
      return NextResponse.json({ group, questions, answers: answers.map((answer) => {
        const likes = answer.likes_by.length;
        const likesScore = Math.min(likes, 10);
        const finalScore = answer.score !== null && answer.teacher_score !== null
          ? Number((answer.teacher_score * 0.5 + answer.score * 0.3 + likesScore * 0.2).toFixed(1))
          : null;
        return {
          id: answer.id,
          question_id: answer.question_id,
          parent_answer_id: answer.parent_answer_id,
          body: answer.body,
          likes,
          likesScore,
          likedByMe: studentId ? answer.likes_by.includes(studentId) : false,
          own: studentId === answer.student_id,
          score: answer.score,
          teacherScore: answer.teacher_score,
          finalScore,
          feedback: answer.feedback,
          alias: aliases.get(answer.student_id) ?? "alumno",
        };
      }), teacher });
    }
    return jsonError("Vista no válida.");
  } catch (error) {
    console.error("GET /api", error);
    return jsonError("No se pudo consultar la información.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    if (body.action === "teacher_signup" || body.action === "teacher_login") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || password.length < 12) return jsonError("Usa un correo y una contraseña de al menos 12 caracteres.");
      const auth = getSupabaseAuth();
      if (body.action === "teacher_signup") {
        const { data, error } = await auth.auth.signUp({ email, password });
        if (error) return jsonError("No se pudo crear la cuenta docente. Revisa el correo o inténtalo de nuevo.", 400);
        if (!data.user || !data.session) return NextResponse.json({ confirmationRequired: true });
        const response = NextResponse.json({ ok: true });
        response.cookies.delete(studentCookie);
        response.cookies.set(teacherCookie, teacherCookieValue(data.user.id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: cookieLifetime });
        return response;
      }
      const { data, error } = await auth.auth.signInWithPassword({ email, password });
      if (error || !data.user) return jsonError("Correo o contraseña incorrectos.", 401);
      const response = NextResponse.json({ ok: true });
      response.cookies.delete(studentCookie);
      response.cookies.set(teacherCookie, teacherCookieValue(data.user.id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: cookieLifetime });
      return response;
    }
    if (body.action === "teacher_logout") {
      const response = NextResponse.json({ ok: true });
      response.cookies.delete(teacherCookie);
      return response;
    }
    if (body.action === "student_logout") {
      const response = NextResponse.json({ ok: true });
      response.cookies.delete(studentCookie);
      return response;
    }
    if (body.action === "create_group") {
      const teacherId = teacherIdFromSession(request);
      if (!teacherId) return jsonError("Inicia sesión con tu cuenta docente.", 401);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      if (!name) return jsonError("Ponle un nombre al grupo.");
      const code = randomBytes(4).toString("hex").toUpperCase();
      const { data, error } = await supabase.from("groups").insert({ owner_id: teacherId, name, code }).select("id, name, code").single();
      if (error) throw error;
      return NextResponse.json({ group: data });
    }
    if (body.action === "create_question" || body.action === "toggle_question") {
      const teacherId = teacherIdFromSession(request);
      if (!teacherId) return jsonError("Inicia sesión con tu cuenta docente.", 401);
      if (body.action === "create_question") {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > 500) return jsonError("La pregunta debe tener entre 1 y 500 caracteres.");
        if (containsProfanity(text)) return jsonError("La pregunta contiene lenguaje no permitido.");
        if (typeof body.groupId !== "string" || !(await teacherOwnsGroup(supabase, teacherId, body.groupId))) return jsonError("No puedes crear preguntas en un grupo ajeno.", 403);
        const { data, error } = await supabase.from("questions").insert({ group_id: body.groupId, text, rubric: typeof body.rubric === "string" ? body.rubric.trim().slice(0, 1000) : "", active: true }).select("id").single();
        if (error) throw error;
        return NextResponse.json({ question: data });
      }
      if (typeof body.questionId !== "string" || !(await teacherOwnsQuestion(supabase, teacherId, body.questionId))) return jsonError("No puedes modificar preguntas de un grupo ajeno.", 403);
      const { data, error } = await supabase.from("questions").update({ active: Boolean(body.active) }).eq("id", body.questionId).select("id").single();
      if (error) throw error;
      return NextResponse.json({ question: data });
    }
    if (body.action === "join") {
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const realName = typeof body.realName === "string" ? body.realName.trim().slice(0, 100) : "";
      if (!code || !realName) return jsonError("Escribe el código y tu nombre.");
      const { data: group, error: groupError } = await supabase.from("groups").select("id").eq("code", code).maybeSingle();
      if (groupError) throw groupError;
      if (!group) return jsonError("No encontramos ese grupo.", 404);
      const alias = `capibara${randomBytes(2).readUInt16BE(0) % 9000 + 1000}`;
      const { data: student, error } = await supabase.from("students").insert({ group_id: group.id, real_name: realName, alias }).select("id, alias").single();
      if (error) throw error;
      const response = NextResponse.json({ student: { alias: student.alias } });
      const session = `${student.id}.${Date.now() + cookieLifetime * 1000}`;
      response.cookies.delete(teacherCookie);
      response.cookies.set(studentCookie, `${session}.${signature(`student:${session}`)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: cookieLifetime });
      return response;
    }
    if (body.action === "answer") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 500) return jsonError("Tu respuesta debe tener entre 1 y 500 caracteres.");
      if (containsProfanity(text)) return jsonError("Tu respuesta contiene lenguaje no permitido. Revísala y vuelve a intentar.");
      const studentId = studentIdFromSession(request);
      if (!studentId || typeof body.questionId !== "string") return jsonError("Sesión de alumno no válida; vuelve a entrar al grupo.", 401);
      const { data: question, error: questionError } = await supabase.from("questions").select("id, group_id, active").eq("id", body.questionId).maybeSingle();
      if (questionError) throw questionError;
      if (!question?.active) return jsonError("Esta pregunta ya no está activa.", 409);
      const { data: student, error: studentError } = await supabase.from("students").select("id, group_id").eq("id", studentId).maybeSingle();
      if (studentError) throw studentError;
      if (!student || student.group_id !== question.group_id || student.group_id !== body.groupId) return jsonError("Sesión de alumno no válida.", 403);
      const { error } = await supabase.from("answers").insert({ question_id: body.questionId, student_id: studentId, body: text });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reply") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 500) return jsonError("Tu respuesta debe tener entre 1 y 500 caracteres.");
      if (containsProfanity(text)) return jsonError("Tu respuesta contiene lenguaje no permitido. Revísala y vuelve a intentar.");
      const studentId = studentIdFromSession(request);
      if (!studentId || typeof body.answerId !== "string") return jsonError("Sesión de alumno no válida; vuelve a entrar al grupo.", 401);
      const { data: parent, error: parentError } = await supabase.from("answers").select("id, student_id, question_id, parent_answer_id").eq("id", body.answerId).maybeSingle();
      if (parentError) throw parentError;
      if (!parent) return jsonError("No encontramos esa respuesta.", 404);
      if (parent.parent_answer_id) return jsonError("Solo puedes responder a una publicación principal.");
      if (parent.student_id === studentId) return jsonError("Puedes responder a publicaciones de otros alumnos.");
      const { data: question, error: questionError } = await supabase.from("questions").select("id, group_id, active").eq("id", parent.question_id).maybeSingle();
      if (questionError) throw questionError;
      if (!question?.active) return jsonError("Esta pregunta ya no está activa.", 409);
      const { data: student, error: studentError } = await supabase.from("students").select("id, group_id").eq("id", studentId).maybeSingle();
      if (studentError) throw studentError;
      if (!student || student.group_id !== question.group_id) return jsonError("Solo puedes responder en tu grupo.", 403);
      const { error } = await supabase.from("answers").insert({ question_id: question.id, student_id: studentId, parent_answer_id: parent.id, body: text });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "like") {
      const studentId = studentIdFromSession(request);
      if (!studentId || typeof body.answerId !== "string") return jsonError("Sesión no válida; vuelve a entrar al grupo.", 401);
      const { data: answer, error: answerError } = await supabase.from("answers").select("id, student_id, question_id").eq("id", body.answerId).maybeSingle();
      if (answerError) throw answerError;
      if (!answer) return jsonError("La respuesta ya no existe.", 404);
      if (answer.student_id === studentId) return jsonError("No puedes dar like a tu propia respuesta.");
      const { data: student, error: studentError } = await supabase.from("students").select("id, group_id").eq("id", studentId).maybeSingle();
      if (studentError) throw studentError;
      if (!student) return jsonError("Sesión no válida.", 403);
      const { data: question, error: questionError } = await supabase.from("questions").select("group_id").eq("id", answer.question_id).single();
      if (questionError) throw questionError;
      if (student.group_id !== question.group_id) return jsonError("Solo puedes votar respuestas de tu grupo.", 403);
      const { data, error } = await supabase.rpc("toggle_answer_like", { p_answer_id: body.answerId, p_student_id: studentId });
      if (error) throw error;
      return NextResponse.json({ likes: data });
    }
    if (body.action === "teacher_grade") {
      const teacherId = teacherIdFromSession(request);
      if (!teacherId) return jsonError("Inicia sesión con tu cuenta docente.", 401);
      if (typeof body.answerId !== "string" || !Number.isInteger(body.score) || body.score < 1 || body.score > 10) {
        return jsonError("Asigna una calificación docente entera del 1 al 10.");
      }
      if (!(await teacherOwnsAnswer(supabase, teacherId, body.answerId))) return jsonError("No puedes calificar respuestas de un grupo ajeno.", 403);
      const { data: answer, error: answerError } = await supabase.from("answers").select("student_id").eq("id", body.answerId).maybeSingle();
      if (answerError) throw answerError;
      if (!answer) return jsonError("No encontramos la respuesta.", 404);
      const { error: updateError } = await supabase.from("answers").update({ teacher_score: body.score }).eq("id", body.answerId);
      if (updateError) throw updateError;
      const { data: student, error: studentError } = await supabase.from("students").select("real_name").eq("id", answer.student_id).single();
      if (studentError) throw studentError;
      return NextResponse.json({ realName: student.real_name });
    }
    if (body.action === "grade") {
      const teacherId = teacherIdFromSession(request);
      if (!teacherId) return jsonError("Inicia sesión con tu cuenta docente.", 401);
      if (typeof body.answerId !== "string" || !(await teacherOwnsAnswer(supabase, teacherId, body.answerId))) return jsonError("No puedes revisar respuestas de un grupo ajeno.", 403);
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return jsonError("Añade GEMINI_API_KEY para activar la evaluación con IA.", 503);
      const { data: answer, error: answerError } = await supabase.from("answers").select("id, body, question_id").eq("id", body.answerId).maybeSingle();
      if (answerError) throw answerError;
      if (!answer) return jsonError("No encontramos la respuesta.", 404);
      const { data: question, error: questionError } = await supabase.from("questions").select("text, rubric").eq("id", answer.question_id).single();
      if (questionError) throw questionError;
      const client = new GoogleGenerativeAI(apiKey);
      const prompt = `Evalúa esta respuesta educativa de forma breve y constructiva. No infieras la identidad del alumno. Devuelve un objeto JSON con score (entero del 1 al 10) y feedback (máximo 300 caracteres).\nPregunta: ${question.text}\nCriterios del docente: ${question.rubric || "Claridad, pertinencia y razonamiento."}\nRespuesta: ${answer.body}`;
      const modelNames = Array.from(new Set([
        process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        "gemini-3.8-flash",
      ]));
      let responseText: string | null = null;
      for (const modelName of modelNames) {
        const model = client.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: "application/json" },
        }, { timeout: 8000 });
        try {
          const result = await model.generateContent(prompt);
          responseText = result.response.text();
          break;
        } catch (error) {
          const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
          const timedOut = error instanceof Error && /timeout|timed out|aborted/i.test(error.message);
          if (!timedOut && ![404, 429, 503].includes(status)) {
            console.error("Gemini generation failed", error);
            return jsonError("Gemini no pudo generar la revisión. Verifica la clave y el acceso al modelo.", 502);
          }
          console.warn(`Gemini model ${modelName} unavailable (${timedOut ? "timeout" : status}); trying fallback.`);
        }
      }
      if (!responseText) return jsonError("Gemini tardó demasiado o está temporalmente ocupado. Inténtalo de nuevo en unos segundos.", 503);
      let evaluation: { score: number; feedback: string };
      try {
        evaluation = JSON.parse(responseText) as { score: number; feedback: string };
      } catch {
        return jsonError("Gemini no devolvió un comentario válido. Intenta evaluar de nuevo.", 502);
      }
      if (!Number.isFinite(evaluation.score) || typeof evaluation.feedback !== "string") throw new Error("Gemini devolvió una evaluación no válida.");
      const score = Math.min(10, Math.max(1, Math.round(evaluation.score)));
      const feedback = evaluation.feedback.trim().slice(0, 300);
      const { error } = await supabase.from("answers").update({ score, feedback }).eq("id", answer.id);
      if (error) throw error;
      return NextResponse.json({ score, feedback });
    }
    if (body.action === "reveal_name") {
      const teacherId = teacherIdFromSession(request);
      if (!teacherId) return jsonError("Inicia sesión con tu cuenta docente.", 401);
      if (typeof body.answerId !== "string") return jsonError("Respuesta no válida.");
      if (!(await teacherOwnsAnswer(supabase, teacherId, body.answerId))) return jsonError("No puedes consultar respuestas de un grupo ajeno.", 403);
      const { data: answer, error: answerError } = await supabase.from("answers").select("student_id").eq("id", body.answerId).maybeSingle();
      if (answerError) throw answerError;
      if (!answer) return jsonError("No encontramos la respuesta.", 404);
      const { data: student, error: studentError } = await supabase.from("students").select("real_name").eq("id", answer.student_id).single();
      if (studentError) throw studentError;
      return NextResponse.json({ realName: student.real_name, aiAvailable: Boolean(process.env.GEMINI_API_KEY) });
    }
    return jsonError("Acción no válida.");
  } catch (error) {
    console.error("POST /api", error);
    return jsonError("Ocurrió un error al procesar la solicitud.", 500);
  }
}