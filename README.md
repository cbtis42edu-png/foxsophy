# Foxsophie

Aplicación mobile-first para grupos de clase: el docente crea grupos y preguntas, los alumnos entran con un código y un alias automático, publican respuestas de hasta 500 caracteres y votan respuestas ajenas. El docente puede solicitar una evaluación orientativa de Gemini.

## Requisitos

- Node.js 20 o superior y npm.
2. Copia `.env.example` a `.env.local` y completa las variables.
3. En Supabase, abre **SQL Editor** y ejecuta `supabase/schema.sql`.
4. En **Authentication → URL Configuration**, configura el Site URL y las Redirect URLs para localhost y tu dominio desplegado.
5. Ejecuta `npm run dev` y abre http://localhost:3000.
## Instalación local

1. Instala dependencias con `npm install`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: clave pública anon/publishable; se usa para Supabase Auth. Las escrituras de datos siguen pasando por el servidor.
## Variables de entorno

- `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: clave pública anon; se conserva por compatibilidad con la configuración habitual, no se usa para escrituras.
- `SUPABASE_SERVICE_ROLE_KEY`: clave de servidor. Nunca la publiques ni la pongas en una variable `NEXT_PUBLIC_`.
- `TEACHER_ACCESS_CODE`: contraseña compartida del panel docente; usa una cadena larga y única.
- `GEMINI_API_KEY`: clave de Google AI Studio. Es opcional; sin ella, el resto de la aplicación funciona y las evaluaciones IA no están disponibles.
- `GEMINI_MODEL`: modelo Gemini; por defecto `gemini-3.1-flash-lite`.

### Conectar Gemini

1. Crea una clave en [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Guárdala en `GEMINI_API_KEY` dentro de `.env.local`; no la incluyas en código ni en una variable `NEXT_PUBLIC_`.
3. Usa `GEMINI_MODEL=gemini-3.1-flash-lite` (o un modelo disponible en tu proyecto de AI Studio) y reinicia `npm run dev`.
4. En Vercel, agrega `GEMINI_API_KEY` y `GEMINI_MODEL` en **Settings → Environment Variables** y vuelve a desplegar.

Gemini recibe la pregunta, la rúbrica y el texto anónimo de la respuesta, nunca el nombre real. El nombre se mantiene oculto en la lectura normal y solo se devuelve al docente autenticado al pulsar **Calificar y revelar nombre**.

La calificación final se calcula con `50% docente + 30% Gemini + 20% likes`. Los likes aportan un punto cada uno hasta un máximo de 10; la nota final se muestra una vez que docente y Gemini hayan calificado la respuesta.

## Despliegue en Vercel

1. Sube el repositorio a GitHub y en Vercel elige **Add New → Project** para importarlo.
2. Deja el framework como **Next.js** y el comando de build como `npm run build`.
3. En **Settings → Environment Variables**, configura las variables de `.env.example` para Production (y Preview si corresponde). No agregues prefijo público a las claves de servicio o Gemini.
4. Ejecuta `supabase/schema.sql` en el SQL Editor del mismo proyecto Supabase.

## Cuentas docentes y grupos existentes

Cada docente crea una cuenta con su correo y contraseña desde la pestaña **Docente**. Los grupos nuevos quedan vinculados automáticamente a esa cuenta; otros docentes no pueden verlos ni editarlos. Si Supabase exige confirmar el correo, abre el enlace recibido y después inicia sesión.

Al agregar `owner_id`, los grupos creados con versiones anteriores quedan sin propietario y no aparecen en ninguna cuenta docente. Para asignarlos, abre **Authentication → Users**, copia el UUID del docente, y ejecuta en SQL Editor una actualización por cada grupo que deba conservar:

```sql
update public.groups
set owner_id = 'UUID-DEL-DOCENTE'
where code = 'CODIGO-DEL-GRUPO' and owner_id is null;
```

No asignes todos los grupos a una cuenta si pertenecen a docentes distintos. `TEACHER_ACCESS_CODE` ya no se utiliza y se puede retirar de `.env.local`.

## Logo

Coloca el archivo del logo en `public/foxsophie-logo.png` y úsalo en la cabecera con la ruta `/foxsophie-logo.png`. Se recomienda un PNG transparente o SVG optimizado, con variante cuadrada y contraste adecuado sobre fondo claro. Adjunta el archivo al chat si quieres que lo integre y adapte la paleta a sus colores.
La clave `service_role` solo se lee en la ruta API del servidor; las tablas tienen RLS activado y no hay políticas de acceso directo. Mantén las variables de entorno fuera de Git. Configura límites de solicitudes antes de abrir la app públicamente: el acceso de alumno usa un código de grupo y alias, no una cuenta verificada. El filtro de groserías es una lista básica en servidor; revisa y adapta `lib/moderation.ts` a tu comunidad.

## Comandos

- `npm run dev`: desarrollo local.
- `npm run build`: verificación de producción.
- `npm start`: servidor de producción local tras compilar.