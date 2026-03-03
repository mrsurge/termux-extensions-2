export function applyBreadcrumbFileIcon(getIconFn, iconSpan, name, theme) {
  getIconFn(name, theme).then(function(ic) {
    if (ic && ic.svg) iconSpan.innerHTML = ic.svg;
    if (ic && ic.color) iconSpan.style.color = ic.color;
  }).catch(function() {});
}
