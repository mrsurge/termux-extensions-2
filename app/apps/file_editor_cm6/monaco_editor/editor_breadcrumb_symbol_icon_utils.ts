export function breadcrumbSymbolIcon(
  kind: unknown,
  symbolMap: Record<string | number, [string, string]>,
): string {
  const entry =
    typeof kind === 'string' || typeof kind === 'number'
      ? symbolMap[kind]
      : undefined;
  const cls = entry ? entry[0] : 'codicon-symbol-misc';
  const color = entry ? entry[1] : '#8b949e';
  return `<span class="codicon ${cls}" style="color:${color};font-size:14px;line-height:1"></span>`;
}
