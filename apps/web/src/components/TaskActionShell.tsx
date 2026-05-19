import type { ReactNode } from 'react';

/**
 * TaskActionShell
 *
 * 任务工作台中每个"处理方式"模块的统一外壳。负责三态切换：
 *   - 'idle'   : 折叠，只显示标题 + 状态 + 一行 hint，点击展开。
 *   - 'review' : 已提交后再次打开时的"锁定预览"，显示提交摘要 + 关键字段，
 *                不直接呈现表单；只有点击"继续补充记录"才进入 edit。
 *   - 'edit'   : 真正展开表单。本组件用 children 渲染表单内容。
 *
 * 这样可以保证：
 *   1. 进入页面默认全部折叠（状态由父组件控制）。
 *   2. 已提交的模块默认进入 review，让护士先看清"上一次提交了什么"，
 *      避免在不知道情况下重复填写。
 *   3. 真正要补充时，明确点击"继续补充记录"，按钮文案不再是"完成任务"。
 *   4. 表单提交期间显示 loading 遮罩，防止重复提交。
 */
export type ActionShellViewState = 'idle' | 'review' | 'edit';

export type ActionShellStatusTone =
  | 'pending'
  | 'in-progress'
  | 'saved'
  | 'alert-linked'
  | 'locked';

export type ActionShellResult = {
  label: string;
  savedAt: string;
  details: string[];
  statusText?: string;
  syncedAlert?: boolean;
};

type Props = {
  /** 模块业务标识。仅用于 data-attr，UI 上不展示。 */
  moduleKey: string;

  /** 模块标题（如"电话随访沟通"）。 */
  title: string;

  /** 模块小标签（如"电话随访记录"），显示在标题上方。 */
  kicker: string;

  /** 模块说明 hint。 */
  hint: string;

  /** 当前展示状态。 */
  view: ActionShellViewState;

  /** 状态文案（如"未填写"/"已保存 10:42"）。 */
  statusLabel: string;

  /** 状态色调，决定徽章颜色。 */
  statusTone: ActionShellStatusTone;

  /** 已提交后的结果摘要；只有 view === 'review' 时使用。 */
  result?: ActionShellResult | null;

  /** 是否正在提交。提交期间表单区遮罩 + 禁用。 */
  isSubmitting?: boolean;

  /** 折叠态显示的右侧按钮文案，例如"展开填写" / "查看 / 继续补充"。 */
  collapsedActionText: string;

  /** 折叠态点击行为：父组件根据是否已有 result 决定进入 review 还是 edit。 */
  onExpand: () => void;

  /** 折叠按钮。 */
  onCollapse: () => void;

  /** 从 review 切到 edit。 */
  onContinueEdit?: () => void;

  /**
   * 强制锁死本模块，不允许再提交（例如任务已结案后的 CLOSE 模块）。
   * 此时即便 view !== 'idle'，也只渲染锁定提示，不渲染 children/review。
   */
  locked?: boolean;

  /** 锁定时显示的说明。 */
  lockedNotice?: ReactNode;

  /** view === 'edit' 时渲染的表单内容。 */
  children?: ReactNode;
};

function toneClassName(tone: ActionShellStatusTone) {
  return `module-status ${tone}`;
}

function StatusBadge({ label, tone }: { label: string; tone: ActionShellStatusTone }) {
  return <em className={toneClassName(tone)}>{label}</em>;
}

function ReviewBody({ result }: { result: ActionShellResult }) {
  return (
    <div className="action-shell-review">
      <header>
        <span className="review-check">✓</span>
        <div>
          <strong>{result.label}</strong>
          <p>
            提交时间：{new Date(result.savedAt).toLocaleString('zh-CN', { hour12: false })}
            ｜处理人：当前护士
          </p>
        </div>
      </header>
      {result.details.length > 0 && (
        <ul className="review-details">
          {result.details.map((item, idx) => (
            <li key={`${idx}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
      {result.syncedAlert && (
        <p className="review-synced-alert">关联风险预警：已同步处置</p>
      )}
    </div>
  );
}

export function TaskActionShell(props: Props) {
  const {
    moduleKey,
    title,
    kicker,
    hint,
    view,
    statusLabel,
    statusTone,
    result,
    isSubmitting,
    collapsedActionText,
    onExpand,
    onCollapse,
    onContinueEdit,
    locked,
    lockedNotice,
    children,
  } = props;

  // 折叠态：一行式入口卡片
  if (view === 'idle') {
    return (
      <section
        className={`action-shell idle ${locked ? 'locked' : ''}`}
        data-module={moduleKey}
      >
        <button
          type="button"
          className="action-shell-trigger"
          onClick={onExpand}
          disabled={locked}
        >
          <div className="action-shell-trigger-main">
            <span className="action-shell-kicker">{kicker}</span>
            <strong>{title}</strong>
            <p>{hint}</p>
          </div>
          <div className="action-shell-trigger-meta">
            <StatusBadge label={statusLabel} tone={statusTone} />
            <small>{locked ? '已结案' : collapsedActionText}</small>
          </div>
        </button>
      </section>
    );
  }

  // 锁定态：完全不能再提交（结案后再点 CLOSE 等场景）
  if (locked) {
    return (
      <section
        className="action-shell locked-state panel"
        data-module={moduleKey}
        aria-busy={isSubmitting || false}
      >
        <header className="action-shell-header">
          <div>
            <span className="action-shell-kicker">{kicker}</span>
            <h2>{title}</h2>
            <p className="section-hint">{hint}</p>
          </div>
          <StatusBadge label={statusLabel} tone={statusTone} />
        </header>
        <div className="submitted-lock-card">
          {lockedNotice ?? (
            <>
              <strong>当前任务已经结案</strong>
              <p>不能重复提交"完成任务"。如需补充记录，请使用其他模块。</p>
            </>
          )}
        </div>
        <div className="action-shell-footer">
          <button
            type="button"
            className="secondary-button compact-link-btn"
            onClick={onCollapse}
          >
            收起
          </button>
        </div>
      </section>
    );
  }

  // 复审态：显示已提交摘要 + 继续补充按钮
  if (view === 'review' && result) {
    return (
      <section
        className="action-shell review-state panel"
        data-module={moduleKey}
      >
        <header className="action-shell-header">
          <div>
            <span className="action-shell-kicker">{kicker}</span>
            <h2>{title}</h2>
            <p className="section-hint">本次提交结果已锁定。如需更新请明确选择"继续补充记录"。</p>
          </div>
          <StatusBadge label={statusLabel} tone={statusTone} />
        </header>
        <ReviewBody result={result} />
        <div className="action-shell-footer">
          {onContinueEdit && (
            <button
              type="button"
              className="secondary-button compact-link-btn"
              onClick={onContinueEdit}
            >
              继续补充记录
            </button>
          )}
          <button
            type="button"
            className="ghost-button compact-link-btn"
            onClick={onCollapse}
          >
            返回摘要
          </button>
        </div>
      </section>
    );
  }

  // 编辑态：渲染表单 + 提交时遮罩
  return (
    <section
      className={`action-shell edit-state panel ${isSubmitting ? 'submitting' : ''}`}
      data-module={moduleKey}
      aria-busy={isSubmitting || false}
    >
      <header className="action-shell-header">
        <div>
          <span className="action-shell-kicker">{kicker}</span>
          <h2>
            {result ? `补充记录：${title}` : title}
          </h2>
          <p className="section-hint">{hint}</p>
        </div>
        <StatusBadge label={statusLabel} tone={statusTone} />
      </header>

      {result && (
        <div className="action-shell-prev-result-note">
          已存在上一次提交（{new Date(result.savedAt).toLocaleString('zh-CN', { hour12: false })}）。
          本次填写将作为<strong>补充记录</strong>保存，不会覆盖原记录、也不会再次完成任务。
        </div>
      )}

      <div className="action-shell-edit-body">{children}</div>

      {isSubmitting && (
        <div className="action-shell-busy-mask" role="status" aria-live="polite">
          <div className="action-shell-busy-card">
            <span className="action-shell-spinner" aria-hidden />
            <strong>正在保存...</strong>
            <p>请勿重复提交或关闭页面。</p>
          </div>
        </div>
      )}
    </section>
  );
}
