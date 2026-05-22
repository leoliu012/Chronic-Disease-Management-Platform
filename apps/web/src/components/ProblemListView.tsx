import { useState } from 'react';
import { Link } from 'react-router-dom';

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description: string;
  data: any;
};

type Problem = {
  id: string;
  diseaseType: string;
  diseaseName: string;
  riskLevel: string;
  status: 'processing' | 'stable' | 'monitoring';
  profile?: TimelineEvent;
  latestVitals: TimelineEvent[];
  relatedAlerts: TimelineEvent[];
  relatedTasks: TimelineEvent[];
  recentDispositions: TimelineEvent[];
};

type ProblemListViewProps = {
  problems: Problem[];
  patientId: string;
  riskLabelMap: Record<string, string>;
  vitalTypeLabelMap: Record<string, string>;
  vitalUnitMap: Record<string, string>;
  taskTypeLabelMap: Record<string, string>;
  followUpTypeLabelMap: Record<string, string>;
  formatTime: (value?: string) => string;
  localizeBackendText: (value?: string | null) => string;
  getRiskClass: (riskLevel: string) => string;
};

export function ProblemListView({
  problems,
  patientId,
  riskLabelMap,
  vitalTypeLabelMap,
  vitalUnitMap,
  taskTypeLabelMap,
  followUpTypeLabelMap,
  formatTime,
  localizeBackendText,
  getRiskClass,
}: ProblemListViewProps) {
  const [expandedProblems, setExpandedProblems] = useState<Set<string>>(new Set());

  const toggleProblem = (problemId: string) => {
    setExpandedProblems((prev) => {
      const next = new Set(prev);
      if (next.has(problemId)) {
        next.delete(problemId);
      } else {
        next.add(problemId);
      }
      return next;
    });
  };

  if (problems.length === 0) {
    return (
      <section className="panel">
        <div className="problem-empty-state">
          <div className="problem-empty-icon">📋</div>
          <div className="problem-empty-text">
            当前患者尚未建立慢病档案。
            <br />
            请先在"慢病档案"模块中为患者建档。
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="problem-list-container">
      {problems.map((problem) => {
        const isExpanded = expandedProblems.has(problem.id);
        const latestVital = problem.latestVitals[0];
        const hasActiveIssues = problem.relatedAlerts.length > 0 || problem.relatedTasks.length > 0;

        let problemCardClass = 'problem-card';
        if (problem.status === 'processing') {
          if (problem.riskLevel === 'HIGH' || problem.riskLevel === 'VERY_HIGH') {
            problemCardClass += ' problem-high-risk';
          } else {
            problemCardClass += ' problem-medium-risk';
          }
        } else if (problem.status === 'stable') {
          problemCardClass += ' problem-stable';
        }

        return (
          <article key={problem.id} className={problemCardClass}>
            {/* 问题卡片头部 */}
            <div className="problem-card-header" onClick={() => toggleProblem(problem.id)}>
              <div className="problem-card-title-section">
                <div className="problem-card-title">
                  <h3>{problem.diseaseName}</h3>
                  <span className={getRiskClass(problem.riskLevel)}>
                    {riskLabelMap[problem.riskLevel] || problem.riskLevel}
                  </span>
                </div>
                <div className="problem-card-meta">
                  {latestVital && (
                    <div
                      className={`problem-card-meta-item ${
                        problem.relatedAlerts.length > 0
                          ? 'meta-danger'
                          : problem.relatedTasks.length > 0
                            ? 'meta-warning'
                            : 'meta-normal'
                      }`}
                    >
                      <span>最新指标：</span>
                      <strong>
                        {vitalTypeLabelMap[latestVital.data?.type] || latestVital.data?.type}{' '}
                        {latestVital.data?.value} {vitalUnitMap[latestVital.data?.type]}
                      </strong>
                    </div>
                  )}
                  {hasActiveIssues && (
                    <div className="problem-card-meta-item meta-warning">
                      <span>当前动作：</span>
                      <strong>
                        {problem.relatedTasks.length > 0
                          ? `电话随访 ${problem.relatedTasks.length} 条`
                          : `处置预警 ${problem.relatedAlerts.length} 条`}
                      </strong>
                    </div>
                  )}
                  {!hasActiveIssues && problem.latestVitals.length > 0 && (
                    <div className="problem-card-meta-item meta-normal">
                      <span>当前动作：</span>
                      <strong>继续观察</strong>
                    </div>
                  )}
                </div>
              </div>
              <div className={`problem-status-indicator status-${problem.status}`}>
                {problem.status === 'processing' && '处理中'}
                {problem.status === 'monitoring' && '观察中'}
                {problem.status === 'stable' && '稳定'}
              </div>
              <div className={`problem-expand-icon ${isExpanded ? 'expanded' : ''}`}>▼</div>
            </div>

            {/* 问题卡片展开内容 */}
            {isExpanded && (
              <div className="problem-card-content">
                {/* 慢病档案信息 */}
                {problem.profile && (
                  <div className="problem-detail-section">
                    <div className="problem-detail-section-title">慢病档案</div>
                    <div className="problem-detail-grid">
                      <div className="problem-detail-item">
                        <div className="problem-detail-item-label">诊断日期</div>
                        <div className="problem-detail-item-value">
                          {problem.profile.data?.diagnosisDate
                            ? new Date(problem.profile.data.diagnosisDate).toLocaleDateString('zh-CN')
                            : '-'}
                        </div>
                      </div>
                      {problem.profile.data?.diseaseStage && (
                        <div className="problem-detail-item">
                          <div className="problem-detail-item-label">疾病分期</div>
                          <div className="problem-detail-item-value">{problem.profile.data.diseaseStage}</div>
                        </div>
                      )}
                      <div className="problem-detail-item">
                        <div className="problem-detail-item-label">风险等级</div>
                        <div className="problem-detail-item-value">
                          <span className={getRiskClass(problem.riskLevel)}>
                            {riskLabelMap[problem.riskLevel] || problem.riskLevel}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 指标趋势 */}
                {problem.latestVitals.length > 0 && (
                  <div className="problem-detail-section">
                    <div className="problem-detail-section-title">指标趋势（最近7次）</div>
                    <div className="problem-vital-trend">
                      <div className="problem-vital-trend-header">
                        <div className="problem-vital-trend-title">
                          {vitalTypeLabelMap[problem.latestVitals[0].data?.type] || problem.latestVitals[0].data?.type}
                        </div>
                        <div
                          className={`problem-vital-trend-value ${
                            problem.relatedAlerts.length > 0
                              ? 'trend-danger'
                              : problem.relatedTasks.length > 0
                                ? 'trend-warning'
                                : 'trend-normal'
                          }`}
                        >
                          {problem.latestVitals[0].data?.value} {vitalUnitMap[problem.latestVitals[0].data?.type]}
                        </div>
                      </div>
                      <div className="problem-vital-sparkline">
                        {problem.latestVitals
                          .slice(0, 7)
                          .reverse()
                          .map((vital, index) => {
                            const value = parseFloat(vital.data?.value || '0');
                            const maxValue = Math.max(
                              ...problem.latestVitals.map((v) => parseFloat(v.data?.value || '0')),
                            );
                            const height = maxValue > 0 ? (value / maxValue) * 100 : 0;

                            // 简单的颜色判断逻辑
                            let barClass = 'problem-vital-sparkline-bar bar-normal';
                            if (vital.data?.type === 'SYSTOLIC_BP' || vital.data?.type === 'BLOOD_PRESSURE') {
                              if (value >= 160) barClass = 'problem-vital-sparkline-bar bar-danger';
                              else if (value >= 140) barClass = 'problem-vital-sparkline-bar bar-warning';
                            } else if (vital.data?.type === 'BLOOD_GLUCOSE') {
                              if (value >= 10) barClass = 'problem-vital-sparkline-bar bar-danger';
                              else if (value >= 7) barClass = 'problem-vital-sparkline-bar bar-warning';
                            }

                            return (
                              <div
                                key={index}
                                className={barClass}
                                style={{ height: `${height}%` }}
                                title={`${value} ${vitalUnitMap[vital.data?.type]} - ${formatTime(vital.time)}`}
                              />
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 相关风险预警 */}
                {problem.relatedAlerts.length > 0 && (
                  <div className="problem-detail-section">
                    <div className="problem-detail-section-title">相关风险预警</div>
                    <div className="problem-alert-list">
                      {problem.relatedAlerts.map((alert, index) => (
                        <div
                          key={index}
                          className={`problem-alert-item ${
                            alert.data?.riskLevel === 'HIGH' || alert.data?.riskLevel === 'VERY_HIGH'
                              ? 'alert-high'
                              : 'alert-medium'
                          }`}
                        >
                          <div className="problem-alert-icon">⚠</div>
                          <div className="problem-alert-content">
                            <div className="problem-alert-title">{localizeBackendText(alert.title)}</div>
                            <div className="problem-alert-desc">{localizeBackendText(alert.description)}</div>
                            <div className="problem-alert-time">触发时间：{formatTime(alert.time)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 相关待办任务 */}
                {problem.relatedTasks.length > 0 && (
                  <div className="problem-detail-section">
                    <div className="problem-detail-section-title">相关待办任务</div>
                    <div className="problem-task-list">
                      {problem.relatedTasks.map((task, index) => (
                        <div key={index} className="problem-task-item">
                          <div className="problem-task-checkbox" />
                          <div className="problem-task-content">
                            <div className="problem-task-title">{localizeBackendText(task.title)}</div>
                            <div className="problem-task-meta">
                              <span>{taskTypeLabelMap[task.data?.type] || task.data?.type}</span>
                              {task.data?.dueDate && (
                                <span className="problem-task-due">截止：{formatTime(task.data.dueDate)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 最近处置记录 */}
                {problem.recentDispositions.length > 0 && (
                  <div className="problem-detail-section">
                    <div className="problem-detail-section-title">最近处置记录</div>
                    <div className="problem-disposition-list">
                      {problem.recentDispositions.map((disposition, index) => (
                        <div key={index} className="problem-disposition-item">
                          <div className="problem-disposition-header">
                            <div className="problem-disposition-type">
                              {followUpTypeLabelMap[disposition.data?.followUpType] || '随访记录'}
                            </div>
                            <div className="problem-disposition-time">{formatTime(disposition.time)}</div>
                          </div>
                          <div className="problem-disposition-content">
                            {localizeBackendText(disposition.description)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 快捷操作 */}
                <div className="problem-actions">
                  {problem.relatedTasks.length > 0 && problem.relatedTasks[0].data?.id && (
                    <Link
                      className="problem-action-btn btn-primary"
                      to={`/patients/${patientId}?workspace=follow-up`}
                    >
                      电话随访
                    </Link>
                  )}
                  <button className="problem-action-btn" type="button">
                    查看完整档案
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}


