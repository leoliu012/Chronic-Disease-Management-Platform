export type PatientSessionRequestContext = {
  sessionId: string;
  demoOpenId?: string | null;
  miniProgramAppId?: string | null;
  miniProgramOpenId?: string | null;
  patientId: string;
};

export type PatientSessionRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  patientSession?: PatientSessionRequestContext;
};
