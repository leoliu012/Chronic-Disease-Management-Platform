import { Navigate, useParams, useSearchParams } from 'react-router-dom';

export function PatientTaskProcessingPage() {
  const { patientId } = useParams();
  const [searchParams] = useSearchParams();

  if (!patientId) {
    return <Navigate to="/patients" replace />;
  }

  const next = new URLSearchParams(searchParams);
  next.set('taskPanel', '1');

  if (!next.get('mode')) {
    next.set('mode', 'close');
  }

  const query = next.toString();
  return <Navigate to={`/patients/${patientId}${query ? `?${query}` : ''}`} replace />;
}
