import { z } from "zod";
import { publicProcedure, router } from "./trpc";

const appRouter = router({
  getEcho: publicProcedure.input(z.string()).query(({ input }) => {
    return {
      greeting: `hello ${input}`,
    };
  }),
});

// Export type router type signature,
// NOT the router itself.
export type AppRouter = typeof appRouter;

type a = AppRouter["_def"]["procedures"];
