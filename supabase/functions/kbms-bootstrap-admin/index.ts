// The initial super-administrator has already been provisioned.
// Keep this retired handler in source control so a future deployment cannot
// accidentally restore the unauthenticated bootstrap implementation.
Deno.serve(async (_request: Request) => {
  return new Response(
    JSON.stringify({
      error: "The one-time KBMS bootstrap endpoint has been retired. Use the authenticated staff administration workflow.",
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
});
