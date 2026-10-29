"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Check, LoaderCircle, LogOut, MessageCircle, Plus, Sparkles, Users } from "lucide-react";

type Group = { id: string; name: string; code: string };
type Question = { id: string; text: string; active: boolean; rubric?: string };
type Answer = { id: string; question_id: string; parent_answer_id: string | null; body: string; likes: number; likesScore: number; likedByMe: boolean; own: boolean; score: number | null; teacherScore: number | null; finalScore: number | null; feedback: string | null; alias: string };

async function api<T = Record<string, unknown>>(method: "GET" | "POST", input: string | object): Promise<T> {
  const response = await fetch(method === "GET" ? `/api?${input as string}` : "/api", {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(input) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
  return result as T;
}

export default function Home() {
  const [mode, setMode] = useState<"student" | "teacher">("student");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [student, setStudent] = useState<{ alias: string } | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [realName, setRealName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [revealedNames, setRevealedNames] = useState<Record<string, string>>({});
  const [gradingAnswerId, setGradingAnswerId] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("aula-student");
    if (saved) {
      try { setStudent(JSON.parse(saved)); } catch { sessionStorage.removeItem("aula-student"); }
    }
  }, []);

  function clearMessages() { setError(""); setNotice(""); }
  async function switchMode(nextMode: "student" | "teacher") {
    clearMessages();
    setMode(nextMode);
    setSelectedGroup(null); setQuestions([]); setAnswers([]);
    setLoggedIn(false); setGroups([]);
    if (nextMode === "student") {
      await api("POST", { action: "teacher_logout" }).catch(() => {});
    } else {
      await api("POST", { action: "student_logout" }).catch(() => {});
      sessionStorage.removeItem("aula-student");
      setStudent(null);
    }
  }
  async function run(task: () => Promise<void>) {
    clearMessages(); setBusy(true);
    try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Algo salió mal."); }
    finally { setBusy(false); }
  }
  async function loadGroup(code: string, teacher = false) {
    const result = await api<{ group: Group; questions: Question[]; answers: Answer[]; teacher: boolean }>("GET", `view=group&code=${encodeURIComponent(code)}`);
    setSelectedGroup(result.group); setQuestions(result.questions); setAnswers(result.answers);
    if (teacher) setMode("teacher");
  }
  async function enterTeacher(email: string, password: string, createAccount: boolean) {
    const authResult = await api<{ confirmationRequired?: boolean }>("POST", {
      action: createAccount ? "teacher_signup" : "teacher_login",
      email,
      password,
    });
    if (authResult.confirmationRequired) {
      setNotice("Cuenta creada. Confirma tu correo desde el mensaje de Supabase y luego inicia sesión.");
      return;
    }
    setLoggedIn(true);
    const result = await api<{ groups: Group[] }>("GET", "view=groups"); setGroups(result.groups);
  }
  async function refreshTeacherGroups() {
    const result = await api<{ groups: Group[] }>("GET", "view=groups"); setGroups(result.groups);
  }
  async function joinGroup() {
    await run(async () => {
      const result = await api<{ student: { alias: string } }>("POST", { action: "join", code: joinCode, realName });
      setLoggedIn(false); setGroups([]);
      setStudent(result.student); sessionStorage.setItem("aula-student", JSON.stringify(result.student));
      await loadGroup(joinCode); setNotice(`Ya estás dentro como ${result.student.alias}.`);
    });
  }
  async function submitAnswer(question: Question) {
    await run(async () => {
      if (!student || !selectedGroup) throw new Error("Vuelve a entrar al grupo para continuar.");
      await api("POST", { action: "answer", text: drafts[question.id] || "", questionId: question.id, groupId: selectedGroup.id });
      setDrafts((current) => ({ ...current, [question.id]: "" })); await loadGroup(selectedGroup.code); setNotice("Tu respuesta ya está en el grupo.");
    });
  }
  async function submitReply(answer: Answer) {
    await run(async () => {
      if (!student || !selectedGroup) throw new Error("Vuelve a entrar al grupo para responder.");
      await api("POST", { action: "reply", answerId: answer.id, text: replyDrafts[answer.id] || "" });
      setReplyDrafts((current) => ({ ...current, [answer.id]: "" }));
      await loadGroup(selectedGroup.code); setNotice("Tu respuesta se agregó a la conversación.");
    });
  }
  async function toggleLike(answer: Answer) {
    await run(async () => {
      if (!student) throw new Error("Vuelve a entrar al grupo para dar likes.");
      await api("POST", { action: "like", answerId: answer.id });
      if (selectedGroup) await loadGroup(selectedGroup.code);
    });
  }
  async function grade(answer: Answer) {
    setGradingAnswerId(answer.id);
    try {
      await run(async () => {
        setNotice("Gemini está revisando esta respuesta. Puede tardar unos segundos...");
        const result = await api<{ score: number; feedback: string }>("POST", { action: "grade", answerId: answer.id });
        if (selectedGroup) await loadGroup(selectedGroup.code, true);
        setNotice(`Revisión de Gemini guardada: ${result.score}/10.`);
      });
    } finally {
      setGradingAnswerId(null);
    }
  }
  async function saveTeacherGrade(answer: Answer, score: number) {
    await run(async () => {
      const result = await api<{ realName: string }>("POST", { action: "teacher_grade", answerId: answer.id, score });
      setRevealedNames((current) => ({ ...current, [answer.id]: result.realName }));
      if (selectedGroup) await loadGroup(selectedGroup.code, true);
      setNotice(`Nota docente guardada. Nombre real: ${result.realName}.`);
    });
  }
  async function logoutTeacher() {
    await run(async () => {
      await api("POST", { action: "teacher_logout" }); setLoggedIn(false); setSelectedGroup(null); setGroups([]);
    });
  }
  const answersFor = (questionId: string) => answers.filter((answer) => answer.question_id === questionId);
  const repliesFor = (answerId: string) => answers.filter((answer) => answer.parent_answer_id === answerId);
  const entryMode = !selectedGroup && (mode === "student" || !loggedIn);

  return <div className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><MessageCircle size={18} /></span><span>Foxsophie</span></div><span className="mode-tag">{mode === "teacher" ? "Profesor" : "Alumno"}</span></header>
    <main className={`main ${entryMode ? "main-entry" : ""}`}>
      <section className={`intro ${entryMode ? "entry-aside" : ""}`}>
        {entryMode ? <>
          <span className="eyebrow">{mode === "teacher" ? "Debate en clase" : "Tu voz cuenta"}</span>
          <h1>{mode === "teacher" ? "Crea la clase, lanza la pregunta y que debatan" : "Defiende tu postura y conversa con tu clase"}</h1>
          <ol className="entry-steps">
            {(mode === "teacher"
              ? ["Crea tu clase y comparte el código", "Publica una pregunta para el grupo", "Revisa respuestas y califica"]
              : ["Entra con el código de tu clase", "Responde preguntas activas", "Vota y responde a tus compañeros"]
            ).map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
          </ol>
        </> : <><span className="eyebrow">Aprender en grupo</span><h1>Las buenas ideas<br />no necesitan nombre.</h1><p>Pregunta, responde y construye algo entre todos.</p></>}
      </section>
      <div className={`role-switch ${mode}`} aria-label="Tipo de acceso"><button aria-pressed={mode === "student"} onClick={() => { void switchMode("student"); }}>Alumno</button><button aria-pressed={mode === "teacher"} onClick={() => { void switchMode("teacher"); }}>Docente</button></div>
      {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
      {mode === "student" ? <>
        {!selectedGroup ? <section className="panel entry-form">
          <span className="eyebrow">Alumno</span><h2>¡Hola, zorrito!</h2><p className="auth-copy">Entra con el código que te dio tu profe.</p>
          {student && <div className="notice">Sesión guardada: <strong>{student.alias}</strong>. Escribe el código del grupo para volver.</div>}
          <div className="stack"><div className="form-row"><label htmlFor="group-code">Código del grupo</label><input id="group-code" autoCapitalize="characters" maxLength={8} placeholder="Ej. A4F92BCD" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} /></div>
            <div className="form-row"><label htmlFor="real-name">Tu nombre real</label><input id="real-name" autoComplete="name" maxLength={100} placeholder="Solo lo verá el docente" value={realName} onChange={(event) => setRealName(event.target.value)} /></div>
            <button className="button full" disabled={busy} onClick={joinGroup}><Users size={17} /> Entrar al grupo</button></div>
        </section> : <>
          <section className="panel panel-header"><div><span className="eyebrow">Tu grupo</span><h2 style={{ margin: "5px 0 0" }}>{selectedGroup.name}</h2></div><div className="inline"><span className="alias">{student?.alias}</span><button className="button ghost" title="Salir del grupo" aria-label="Salir del grupo" onClick={() => { setSelectedGroup(null); setQuestions([]); setAnswers([]); }}><LogOut size={16} /></button></div></section>
          {questions.length === 0 ? <section className="panel empty">Todavía no hay preguntas activas.</section> : questions.map((question) => <section className="panel" key={question.id}>
            <span className="eyebrow">Pregunta activa</span><h2 className="question-title">{question.text}</h2>
            <div className="form-row" style={{ marginTop: 14 }}><label htmlFor={`answer-${question.id}`}>Tu respuesta <span className="muted">· máximo 500 caracteres</span></label><textarea id={`answer-${question.id}`} maxLength={500} placeholder="Comparte tu idea con el grupo..." value={drafts[question.id] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} /><div className="inline" style={{ justifyContent: "space-between" }}><span className="muted small">{(drafts[question.id] || "").length}/500</span><button className="button" disabled={busy} onClick={() => submitAnswer(question)}>Publicar respuesta</button></div></div>
            <div className="question"><div className="inline" style={{ justifyContent: "space-between" }}><h3>La conversación</h3><span className="muted small">{answersFor(question.id).length} respuestas</span></div>
              {answersFor(question.id).length === 0 && <p className="muted small">Sé la primera persona en responder.</p>}
              {answersFor(question.id).filter((answer) => !answer.parent_answer_id).map((answer) => <div className="answer-thread" key={answer.id}>
                <article className="answer"><div className="answer-meta"><span className="alias">{answer.alias}</span></div><p className="answer-body">{answer.body}</p>{answer.finalScore !== null && <p className="evaluation-summary"><strong>Nota final: {answer.finalScore}/10</strong><span>Docente {answer.teacherScore}/10 · Gemini {answer.score}/10 · Likes {answer.likesScore}/10</span></p>}{answer.feedback && <p className="gemini-feedback"><strong>Revisión de Gemini:</strong> {answer.feedback}</p>}<button className="button ghost" aria-label={`Dar like a la respuesta de ${answer.alias}`} title="Me gusta" disabled={busy || !student || answer.own} onClick={() => toggleLike(answer)}><ArrowUp size={15} /> {answer.likes} <span>Like</span>{answer.likedByMe && <Check size={14} />}</button></article>
                {repliesFor(answer.id).length > 0 && <div className="reply-list">{repliesFor(answer.id).map((reply) => <article className="answer reply" key={reply.id}><div className="answer-meta"><span className="alias">{reply.alias}</span></div><p className="answer-body">{reply.body}</p>{reply.finalScore !== null && <p className="evaluation-summary"><strong>Nota final: {reply.finalScore}/10</strong><span>Docente {reply.teacherScore}/10 · Gemini {reply.score}/10 · Likes {reply.likesScore}/10</span></p>}{reply.feedback && <p className="gemini-feedback"><strong>Revisión de Gemini:</strong> {reply.feedback}</p>}<button className="button ghost" aria-label={`Dar like a la respuesta de ${reply.alias}`} title="Me gusta" disabled={busy || !student || reply.own} onClick={() => toggleLike(reply)}><ArrowUp size={15} /> {reply.likes} <span>Like</span>{reply.likedByMe && <Check size={14} />}</button></article>)}</div>}
                {student && !answer.own && <div className="reply-form"><textarea aria-label={`Responder a ${answer.alias}`} maxLength={500} placeholder={`Responder a ${answer.alias}...`} value={replyDrafts[answer.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [answer.id]: event.target.value }))} /><button className="button secondary" disabled={busy || !(replyDrafts[answer.id] || "").trim()} onClick={() => submitReply(answer)}>Responder</button></div>}
              </div>)}
            </div>
          </section>)}
        </>}
      </> : <TeacherPanel busy={busy} loggedIn={loggedIn} groups={groups} selectedGroup={selectedGroup} questions={questions} answers={answers}
        onLogin={(email, password, createAccount) => run(() => enterTeacher(email, password, createAccount))}
        onCreateGroup={(name) => run(async () => { const result = await api<{ group: Group }>("POST", { action: "create_group", name }); await refreshTeacherGroups(); await loadGroup(result.group.code, true); setNotice("Grupo creado. Comparte el código con tus alumnos."); })}
        onSelectGroup={(group) => run(() => loadGroup(group.code, true))}
        onCreateQuestion={(text, questionRubric) => run(async () => { if (!selectedGroup) throw new Error("Selecciona un grupo."); await api("POST", { action: "create_question", groupId: selectedGroup.id, text, rubric: questionRubric }); await loadGroup(selectedGroup.code, true); setNotice("Pregunta publicada."); })}
        onToggleQuestion={(question) => run(async () => { await api("POST", { action: "toggle_question", questionId: question.id, active: !question.active }); if (selectedGroup) await loadGroup(selectedGroup.code, true); })}
        onGrade={grade} onSaveTeacherGrade={saveTeacherGrade} gradingAnswerId={gradingAnswerId} revealedNames={revealedNames} onLogout={logoutTeacher} />}
    </main>
    <footer className="footer">Hecho para conversar con respeto.</footer>
  </div>;
}

function TeacherPanel(props: {
  busy: boolean; loggedIn: boolean; groups: Group[]; selectedGroup: Group | null; questions: Question[]; answers: Answer[];
  gradingAnswerId: string | null;
  revealedNames: Record<string, string>;
  onLogin: (email: string, password: string, createAccount: boolean) => void; onCreateGroup: (name: string) => void; onSelectGroup: (group: Group) => void;
  onCreateQuestion: (text: string, rubric: string) => void; onToggleQuestion: (question: Question) => void; onGrade: (answer: Answer) => void; onSaveTeacherGrade: (answer: Answer, score: number) => void; onLogout: () => void;
}) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [createAccount, setCreateAccount] = useState(false); const [newGroup, setNewGroup] = useState(""); const [newQuestion, setNewQuestion] = useState(""); const [rubric, setRubric] = useState("");
  const [teacherScores, setTeacherScores] = useState<Record<string, string>>({});
  if (!props.loggedIn) return <section className="auth-panel entry-form"><span className="eyebrow">Profesor</span><h2>{createAccount ? "Crea tu cuenta" : "Hola, profe"}</h2><p className="auth-copy">{createAccount ? "Registra tu cuenta personal para crear tus clases." : "Entra para crear tu clase y lanzar el primer debate."}</p><div className="stack"><div className="form-row"><label htmlFor="teacher-email">Correo</label><input id="teacher-email" type="email" placeholder="profe@escuela.mx" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div><div className="form-row"><label htmlFor="teacher-password">Contraseña</label><input id="teacher-password" type="password" autoComplete={createAccount ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onLogin(email, password, createAccount); }} /></div><button className="button full" disabled={props.busy || !email.trim() || password.length < 12} onClick={() => props.onLogin(email, password, createAccount)}>{createAccount ? "Crear cuenta docente" : "Entrar como profesor"}</button><button className="text-button" onClick={() => setCreateAccount((value) => !value)}>{createAccount ? "Ya tengo cuenta. Iniciar sesión" : "Primera vez aquí. Crear cuenta"}</button></div></section>;
  const renderAnswer = (answer: Answer) => {
    const selectedScore = teacherScores[answer.id] || (answer.teacherScore ? String(answer.teacherScore) : "");
    const isGrading = props.gradingAnswerId === answer.id;
    return <article className={answer.parent_answer_id ? "answer reply" : "answer"} key={answer.id}><div className="answer-meta"><span className="alias">{answer.alias}</span><span>{answer.likes} likes · aporte {answer.likesScore}/10</span></div><p className="answer-body">{answer.body}</p>{answer.finalScore !== null && <p className="evaluation-summary"><strong>Nota final: {answer.finalScore}/10</strong><span>Docente {answer.teacherScore}/10 · Gemini {answer.score}/10 · Likes {answer.likesScore}/10</span></p>}{answer.feedback && <p className="gemini-feedback"><strong>Revisión de Gemini:</strong> {answer.feedback}</p>}{props.revealedNames[answer.id] && <p className="identity-note"><strong>Nombre real:</strong> {props.revealedNames[answer.id]}</p>}<div className="grading-actions"><label className="score-control">Nota docente<select aria-label="Calificación docente del 1 al 10" value={selectedScore} onChange={(event) => setTeacherScores((current) => ({ ...current, [answer.id]: event.target.value }))}><option value="">Elegir</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><button className="button secondary" disabled={props.busy || !selectedScore} onClick={() => props.onSaveTeacherGrade(answer, Number(selectedScore))}>Guardar nota / revelar nombre</button><button className="button ghost" disabled={props.busy} onClick={() => props.onGrade(answer)}>{isGrading ? <><LoaderCircle size={15} className="loading-icon" /> Consultando Gemini...</> : <><Sparkles size={15} /> {answer.score === null ? "Revisar con Gemini" : "Revisar otra vez"}</>}</button></div></article>;
  };
  return <div className="stack teacher-dashboard">
    <section className="panel teacher-groups"><div className="panel-header"><h2>Mi clase</h2><button className="button ghost" title="Cerrar sesión" aria-label="Cerrar sesión docente" onClick={props.onLogout}><LogOut size={16} /></button></div>
      <div className="form-row"><label htmlFor="new-group">Crear grupo</label><div className="inline"><input id="new-group" placeholder="Nombre del grupo" maxLength={80} value={newGroup} onChange={(event) => setNewGroup(event.target.value)} /><button className="button" disabled={props.busy || !newGroup.trim()} aria-label="Crear grupo" title="Crear grupo" onClick={() => { props.onCreateGroup(newGroup); setNewGroup(""); }}><Plus size={17} /> Crear</button></div></div>
      {props.groups.length > 0 && <div className="group-list" style={{ marginTop: 18 }}>{props.groups.map((group) => <div className="group-row" key={group.id}><div><strong>{group.name}</strong><div className="group-code" style={{ display: "inline-block", marginTop: 4 }}>{group.code}</div></div><button className="button secondary" onClick={() => props.onSelectGroup(group)}>{props.selectedGroup?.id === group.id ? "Seleccionado" : "Abrir"}</button></div>)}</div>}
    </section>
    {props.selectedGroup ? <>
      <section className="panel teacher-question"><div className="inline" style={{ justifyContent: "space-between", marginBottom: 16 }}><div><span className="eyebrow">Clase seleccionada</span><h2 style={{ margin: "5px 0 0" }}>{props.selectedGroup.name}</h2></div><span className="group-code">{props.selectedGroup.code}</span></div>
        <div className="stack"><div className="form-row"><label htmlFor="new-question">Nueva pregunta <span className="muted">· máximo 500 caracteres</span></label><textarea id="new-question" maxLength={500} placeholder="¿Qué te gustaría preguntar al grupo?" value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} /></div><div className="form-row"><label htmlFor="rubric">Criterios para Gemini <span className="muted">· opcional</span></label><textarea className="rubric" id="rubric" maxLength={1000} placeholder="Ej. Valora la evidencia, la claridad y el razonamiento." value={rubric} onChange={(event) => setRubric(event.target.value)} /></div><button className="button" disabled={props.busy || !newQuestion.trim()} onClick={() => { props.onCreateQuestion(newQuestion, rubric); setNewQuestion(""); }}>Publicar pregunta</button></div>
      </section>
      <section className="panel teacher-answers"><h2>Preguntas y respuestas</h2>{props.questions.length === 0 && <div className="empty">Todavía no has publicado preguntas.</div>}
        {props.questions.map((question) => <div className="question" key={question.id}><div className="panel-header"><div><span className="eyebrow">{question.active ? "Activa" : "Cerrada"}</span><h3 style={{ marginTop: 5 }}>{question.text}</h3></div><button className="button ghost" disabled={props.busy} onClick={() => props.onToggleQuestion(question)}>{question.active ? "Cerrar" : "Activar"}</button></div>
          {props.answers.filter((answer) => answer.question_id === question.id && !answer.parent_answer_id).length === 0 && <p className="muted small">Aún no hay respuestas.</p>}
          {props.answers.filter((answer) => answer.question_id === question.id && !answer.parent_answer_id).map((answer) => <div className="answer-thread" key={answer.id}>{renderAnswer(answer)}{props.answers.filter((reply) => reply.parent_answer_id === answer.id).length > 0 && <div className="reply-list">{props.answers.filter((reply) => reply.parent_answer_id === answer.id).map(renderAnswer)}</div>}</div>)}
        </div>)}
      </section>
    </> : props.groups.length === 0 && <section className="panel empty">Crea tu primer grupo para empezar.</section>}
  </div>;
}