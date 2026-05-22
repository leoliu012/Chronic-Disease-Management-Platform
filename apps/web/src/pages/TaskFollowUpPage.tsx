import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import { useFeedbackMessageBridge } from '../utils/feedbackMessage';

type Patient = {
  id: string;
  name: string;
  gender?: string;
  birthDate?: string;
  hospitalPatientId?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  responsibleDoctorId?: string;
  responsibleNurseId?: string;
};

type Task = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt?: string;
  assigneeId?: string;
  relatedAlertId?: string;
  patient?: Patient;
};

type PatientTimelineResponse = {
  patient: Patient;
};

const nurseId = 'nurse-001';

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险预警随访',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  MEDICATION_ADHERENCE_FOLLOW_UP: '用药依从性随访',
  VITAL_RECHECK_FOLLOW_UP: '指标复测随访',
  VITAL_MEASUREMENT_MISSED: '指标漏测复核',
  QUESTIONNAIRE_REVIEW: '问卷复核',
  LAB_TEST_REMINDER: '检查提醒',
};

const statusLabelMap: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '待处理',
  DONE: '已完成',
  CANCELED: '已取消',
};

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}


function getStatusClass(status?: string) {
  return `status-badge status-${String(status || '').toLowerCase().replace(/_/g, '-')}`;
}

export function TaskFollowUpPage() {
  const { patientId, taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // prominent-feedback-bridge-v1
  useFeedbackMessageBridge(message, error);

  const [callOutcome, setCallOutcome] = useState('CONTACTED');
  const [callContent, setCallContent] = useState('');
  const [followUpResult, setFollowUpResult] = useState('');
  const [nursingAdvice, setNursingAdvice] = useState('');
  const [nextFollowUpTime, setNextFollowUpTime] = useState('');
  const [signature, setSignature] = useState('');
  const [completeTaskAfterSubmit, setCompleteTaskAfterSubmit] = useState(true);
  const [syncRelatedAlert, setSyncRelatedAlert] = useState(false);
  const [relatedAlertHandlingNote, setRelatedAlertHandlingNote] = useState('');
  const [relatedAlertInstruction, setRelatedAlertInstruction] = useState('');

  async function loadTaskDetail() {
    if (!patientId || !taskId) return;

    setLoading(true);
    setError('');

    try {
      const [taskRes, timelineRes] = await Promise.all([
        api.get(`/tasks/${taskId}`),
        api.get(`/patients/${patientId}/timeline`),
      ]);
      const loadedTask = taskRes.data as Task;
      const loadedPatient = (timelineRes.data as PatientTimelineResponse).patient;
      setTask(loadedTask);
      setPatient(loadedTask.patient ?? loadedPatient);
      setCallContent((current) => current || `围绕待办任务“${loadedTask.title}”电话联系患者，核对症状、用药、复测和复诊情况。`);
      setFollowUpResult((current) => current || '已电话联系，待补充患者反馈。');
      setNursingAdvice((current) => current || '请患者按要求复测/用药/复诊，如出现危险症状及时就医。');
      if (loadedTask.relatedAlertId) {
        setRelatedAlertHandlingNote((current) => current || `通过电话随访处理关联风险预警，已核对患者当前症状、用药和复测安排。`);
        setRelatedAlertInstruction((current) => current || '请患者按随访交代完成复测、用药和必要复诊，如出现危险症状及时就医。');
        setSyncRelatedAlert(true);
      }
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '任务详情加载失败，请确认后端服务和任务数据。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTaskDetail();
  }, [patientId, taskId]);

  async function submitCallFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!patientId || !taskId || submitting) return;

    const trimmedSignature = signature.trim();
    if (!trimmedSignature) {
      setError('请填写电子签名后再提交电话随访记录。');
      return;
    }

    if (completeTaskAfterSubmit && syncRelatedAlert && task?.relatedAlertId && !relatedAlertHandlingNote.trim()) {
      setError('已选择同步处理绑定预警，请填写预警处置记录。');
      return;
    }

    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      const outcomeLabel =
        callOutcome === 'CONTACTED'
          ? '已接通'
          : callOutcome === 'NO_ANSWER'
            ? '未接通'
            : callOutcome === 'FAMILY_CONTACTED'
              ? '已联系家属'
              : '需再次联系';

      await api.post(`/patients/${patientId}/follow-ups`, {
        followUpType: 'PHONE',
        followUpTime: new Date().toISOString(),
        content: [
          `电话随访任务：${task?.title ?? taskId}`,
          `联系结果：${outcomeLabel}`,
          callContent.trim(),
          `电子签名：${trimmedSignature}`,
        ].filter(Boolean).join('；'),
        result: followUpResult.trim() || outcomeLabel,
        suggestion: nursingAdvice.trim() || undefined,
        nextFollowUpTime: nextFollowUpTime ? new Date(nextFollowUpTime).toISOString() : undefined,
        operatorId: nurseId,
      });

      if (completeTaskAfterSubmit) {
        await api.patch(`/tasks/${taskId}/status`, {
          status: 'DONE',
          syncRelatedAlert: syncRelatedAlert && Boolean(task?.relatedAlertId),
          relatedAlertHandlingNote: syncRelatedAlert && task?.relatedAlertId
            ? [
                `处置记录：${relatedAlertHandlingNote.trim()}`,
                relatedAlertInstruction.trim() ? `交代内容：${relatedAlertInstruction.trim()}` : '',
                `电子签名：${trimmedSignature}`,
              ].filter(Boolean).join('；')
            : undefined,
        });
      }

      setMessage(
        completeTaskAfterSubmit
          ? syncRelatedAlert && task?.relatedAlertId
            ? '电话随访已保存，待办任务已完成，绑定风险预警已同步标记为已处理。'
            : '电话随访已保存，待办任务已完成。'
          : '电话随访已保存，待办任务状态未变更。',
      );
      await loadTaskDetail();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '电话随访提交失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !task && !patient) {
    return <div className="loading-state">正在加载任务电话随访详情...</div>;
  }

  if (!task || !patient) {
    return (
      <div className="business-page task-follow-up-page">
        <div className="empty-state">任务详情加载失败或数据不存在。</div>
        <button className="secondary-btn" type="button" onClick={() => navigate('/nurse-dashboard')}>返回护士工作台</button>
      </div>
    );
  }

  return (
    <div className="business-page task-follow-up-page">
      <div className="page-header clean-page-header task-follow-up-hero">
        <div>
          <div className="page-kicker">电话随访详情</div>
          <h1>任务处理：先联系患者，再完成任务</h1>
          <p className="page-subtitle">普通待办任务不直接进入风险处置页；风险随访任务默认同步处置关联预警。护士应先电话联系患者、记录沟通内容，并电子签名后提交随访记录。</p>
        </div>
        <div className="task-follow-up-header-actions">
          <Link className="secondary-btn" to="/nurse-dashboard">返回护士工作台</Link>
          <Link className="secondary-btn" to={`/patients/${patient.id}`}>查看患者档案</Link>
        </div>
      </div>

      <section className="task-call-layout">
        <aside className="task-call-contact-card panel">
          <div className="hospital-section-header compact-header">
            <div>
              <span>患者联系信息</span>
              <h2>患者联系信息</h2>
            </div>
          </div>
          <dl className="contact-info-list">
            <div><dt>患者姓名</dt><dd>{patient.name}</dd></div>
            <div><dt>院内号</dt><dd>{patient.hospitalPatientId ?? '-'}</dd></div>
            <div><dt>联系电话</dt><dd><a href={patient.phone ? `tel:${patient.phone}` : undefined}>{patient.phone ?? '-'}</a></dd></div>
            <div><dt>住址</dt><dd>{patient.address ?? '-'}</dd></div>
            <div><dt>紧急联系人</dt><dd>{patient.emergencyContactName ?? '-'} {patient.emergencyContactPhone ? ` / ${patient.emergencyContactPhone ?? '-'}` : ''}</dd></div>
            <div><dt>责任护士</dt><dd>{patient.responsibleNurseId ?? '-'}</dd></div>
          </dl>

          <div className="task-info-box">
            <span>当前任务</span>
            <strong>{task.title}</strong>
            <p>{taskTypeLabelMap[task.type] ?? task.type} · <span className={getStatusClass(task.status)}>{statusLabelMap[task.status] ?? task.status}</span></p>
            <p>截止时间：{formatTime(task.dueAt)}</p>
          </div>

        </aside>

        <section className="panel task-call-form-card">
          <div className="hospital-section-header compact-header">
            <div>
              <span>电话随访记录</span>
              <h2>电话内容记录</h2>
              <p className="section-hint">提交后会生成随访记录；勾选“提交后完成任务”时，系统会同步把该待办标记为完成。</p>
            </div>
          </div>

          <form className="hospital-form task-call-form" onSubmit={submitCallFollowUp} aria-busy={submitting}>
            <label>
              电话联系结果
              <select value={callOutcome} onChange={(event) => setCallOutcome(event.target.value)}>
                <option value="CONTACTED">已接通患者本人</option>
                <option value="FAMILY_CONTACTED">已联系家属/紧急联系人</option>
                <option value="NO_ANSWER">未接通</option>
                <option value="CALL_BACK_REQUIRED">需再次联系</option>
              </select>
            </label>

            <label>
              电话沟通内容 <span className="required-mark">*</span>
              <textarea value={callContent} onChange={(event) => setCallContent(event.target.value)} rows={5} required />
            </label>

            <label>
              随访结果 <span className="required-mark">*</span>
              <textarea value={followUpResult} onChange={(event) => setFollowUpResult(event.target.value)} rows={3} required />
            </label>

            <label>
              护理建议 / 后续安排
              <textarea value={nursingAdvice} onChange={(event) => setNursingAdvice(event.target.value)} rows={3} />
            </label>

            <label>
              下次随访时间
              <input type="datetime-local" value={nextFollowUpTime} onChange={(event) => setNextFollowUpTime(event.target.value)} />
            </label>

            <label>
              电子签名 <span className="required-mark">*</span>
              <input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="请输入护士姓名 / 工号" required />
            </label>

            <label className="task-complete-check">
              <input type="checkbox" checked={completeTaskAfterSubmit} onChange={(event) => setCompleteTaskAfterSubmit(event.target.checked)} />
              提交随访记录后自动标记任务完成
            </label>

            {task.relatedAlertId && completeTaskAfterSubmit && (
              <section className="related-alert-sync-box">
                <label className="task-complete-check">
                  <input type="checkbox" checked={syncRelatedAlert} onChange={(event) => setSyncRelatedAlert(event.target.checked)} />
                  该任务已绑定风险预警，完成任务时同步将该预警标记为已处理
                </label>
                {syncRelatedAlert && (
                  <>
                    <label>
                      预警处置记录 <span className="required-mark">*</span>
                      <textarea value={relatedAlertHandlingNote} onChange={(event) => setRelatedAlertHandlingNote(event.target.value)} rows={3} />
                    </label>
                    <label>
                      交代内容
                      <textarea value={relatedAlertInstruction} onChange={(event) => setRelatedAlertInstruction(event.target.value)} rows={3} />
                    </label>
                  </>
                )}
              </section>
            )}

            <div className="form-actions task-call-submit-actions">
              <button className="button" type="submit" disabled={submitting}>{submitting ? '提交中...' : '提交随访并更新任务'}</button>
              <button className="secondary-button" type="button" onClick={() => navigate('/nurse-dashboard')} disabled={submitting}>暂不提交，返回工作台</button>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}

