/** Runs a change; returns a message for the person when it could not be saved. */
export async function attempt(change: () => Promise<unknown>): Promise<string | null> {
  try {
    await change();
    return null;
  } catch {
    return 'No se ha podido guardar el cambio. Comprueba la conexión y vuelve a intentarlo.';
  }
}
