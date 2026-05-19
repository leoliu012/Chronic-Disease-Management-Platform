import { Navigate, useParams } from 'react-router-dom';

export function TaskFollowUpRedirect() {
  const { patientId, taskId } = useParams();
  const target = patientId && taskId
    ? `/patients/${patientId}/task-processing?taskId=${taskId}&mode=phone`
    : '/nurse-dashboard';

  return <Navigate to={target} replace />;
}
