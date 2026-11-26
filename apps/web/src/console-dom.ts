export function patchText(target: HTMLElement, value: string): void {
  if (target.textContent !== value) target.textContent = value;
}

export function patchHidden(target: HTMLElement, hidden: boolean): void {
  if (target.hidden !== hidden) target.hidden = hidden;
}

export function patchAttr(target: HTMLElement, name: string, value: string): void {
  if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}
