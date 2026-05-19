export function maskPhone(value?: string | null) {
  if (!value) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return value;
  return value.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

export function maskIdCard(value?: string | null) {
  if (!value) return value;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}**********${value.slice(-4)}`;
}

export function maskPatientForList<T extends { phone?: string | null; idCardNo?: string | null }>(
  patient: T,
): T {
  return {
    ...patient,
    phone: maskPhone(patient.phone),
    idCardNo: maskIdCard(patient.idCardNo),
  };
}
