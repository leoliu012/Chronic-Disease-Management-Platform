export type PatientSessionRequestContext = {
  sessionId: string;
  demoOpenId: string;
  patientId: string;
};

export type PatientSessionRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  patientSession?: PatientSessionRequestContext;
};
