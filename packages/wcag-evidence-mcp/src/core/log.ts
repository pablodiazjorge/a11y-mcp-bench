/** Writes one line of diagnostics. Whoever wires the server decides where it goes. */
export type Log = (message: string) => void;
