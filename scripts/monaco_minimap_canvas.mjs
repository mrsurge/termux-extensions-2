// Writing either canvas dimension clears the pixels, even if the value
// didn't change. Only change the backing store when it must be reallocated.
export function preserveMinimapCanvas(source) {
  for (const canvas of ['_canvas', '_decorationsCanvas']) {
    for (const [axis, option] of [['width', 'canvasInnerWidth'], ['height', 'canvasInnerHeight']]) {
      const property = `this.${canvas}.domNode.${axis}`;
      const size = `this._model.options.${option}`;
      const assignment = `${property} = ${size};`;
      if (source.split(assignment).length !== 2) throw new Error('Unexpected Monaco minimap assignment: ' + assignment);
      source = source.replace(assignment, canvas === '_canvas' ? '' : `if (${property} !== ${size}) { ${assignment} }`);
    }
  }
  const paint = 'ctx.putImageData(imageData, 0, 0, 0, dirtyY1, imageData.width, dirtyHeight);';
  if (source.split(paint).length !== 2) throw new Error('Unexpected Monaco minimap paint path');
  // CSS still tracks the pane during layout. Keep the old bitmap until its
  // replacement is ready, including when more than one layout precedes paint.
  return source.replace(paint, `const canvas = ctx.canvas;
        if (canvas.width !== imageData.width || canvas.height !== imageData.height) {
            if (canvas.width !== imageData.width) canvas.width = imageData.width;
            if (canvas.height !== imageData.height) canvas.height = imageData.height;
            ctx.putImageData(imageData, 0, 0);
        } else {
            ${paint}
        }`);
}
