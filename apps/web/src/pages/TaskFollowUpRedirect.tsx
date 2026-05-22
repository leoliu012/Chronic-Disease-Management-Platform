import { Navigate, useParams } from 'react-router-dom';

export function TaskFollowUpRedirect() {
  const { patientId, taskId } = useParams();
  const target = patientId && taskId
    ? `/patients/${patientId}?workspace=follow-up`
    : '/nurse-dashboard';

  return <Navigate to={target} replace />;
}


