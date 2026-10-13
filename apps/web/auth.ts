import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { findManager } from "./lib/managers";

// Detrás del proxy de Railway, la app se ve a sí misma como localhost:8080 y Auth.js armaría mal la URL de
// regreso de Google (redirect_uri_mismatch). Si no hay AUTH_URL, se usa el dominio público que Railway inyecta.
if (!process.env.AUTH_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.AUTH_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

/**
 * Login de gerentes con Google (Auth.js). Lee AUTH_SECRET, AUTH_GOOGLE_ID y AUTH_GOOGLE_SECRET del entorno.
 * Solo entran correos activos en la tabla `managers`; el acceso se vuelve a revisar en cada página.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ profile }) {
      const email = typeof profile?.email === "string" ? profile.email : null;
      if (!email || profile?.email_verified === false) return false;
      return (await findManager(email)) !== null;
    },
  },
});
