import { Fragment, type ReactNode } from 'react';
import { NAME_TOKEN_OPEN, NAME_TOKEN_REGEX } from '../utils/entityNameToken';

/**
 * Visual kind of the chip — lets the stylesheet differentiate medication
 * names, vital indicator names, etc. with subtly different palettes.
 */
export type EntityNameKind =
  | 'generic'
  | 'medication'
  | 'vital'
  | 'plan'
  | 'task'
  | 'field';

type EntityNameProps = {
  children: ReactNode;
  kind?: EntityNameKind;
  /** Optional accessible label override. Defaults to the visible text. */
  title?: string;
};

/**
 * Inline pill chip used to call out a proper-name-like term (medication
 * name, vital indicator, plan title, field name) instead of wrapping it
 * in `「」` Chinese corner-brackets, which read as poor double-quotes.
 *
 *   <EntityName kind="medication">二甲双胍片</EntityName>
 *   <EntityName kind="vital">血糖</EntityName>
 */
export function EntityName({ children, kind = 'generic', title }: EntityNameProps) {
  return (
    <span
      className={`entity-name-chip entity-name-chip-${kind}`}
      title={title}
    >
      {children}
    </span>
  );
}

/**
 * Convert a string that may contain `⟦name⟧` markers into a list of React
 * nodes, replacing each marker run with a styled chip. Strings without any
 * marker are returned unchanged.
 *
 * The output is wrapped in a single `<Fragment>` so it can drop into any
 * JSX slot without leaking extra DOM nodes.
 */
export function renderWithNameChips(
  text: string | null | undefined,
  kind: EntityNameKind = 'generic',
): ReactNode {
  if (text === null || text === undefined) return null;
  const source = String(text);
  if (!source) return source;
  if (source.indexOf(NAME_TOKEN_OPEN) < 0) return source;

  const nodes: ReactNode[] = [];
  let last = 0;
  NAME_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NAME_TOKEN_REGEX.exec(source)) !== null) {
    if (match.index > last) {
      nodes.push(source.slice(last, match.index));
    }
    nodes.push(
      <EntityName key={`chip-${nodes.length}-${match.index}`} kind={kind}>
        {match[1]}
      </EntityName>,
    );
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    nodes.push(source.slice(last));
  }
  return <Fragment>{nodes}</Fragment>;
}
