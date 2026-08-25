export function readFloatingPosition(value) {
  if (
    !value
    || typeof value !== "object"
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
  ) return null;
  return { x: Number(value.x), y: Number(value.y) };
}

export function clampFloatingPosition({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = 8,
}) {
  const maxX = Math.max(margin, viewportWidth - width - margin);
  const maxY = Math.max(margin, viewportHeight - height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y)),
  };
}

export function pointerMoved(startX, startY, currentX, currentY, threshold = 6) {
  return Math.hypot(currentX - startX, currentY - startY) >= threshold;
}
