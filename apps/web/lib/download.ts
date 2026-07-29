/** 触发浏览器下载文本文件 */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 把文件名清洗为安全的短名 */
export function safeFilename(name: string, max = 40): string {
  const cleaned = name.replace(/[\\/:*?"<>|\n\r\t]+/g, "_").trim();
  return (cleaned || "wabao").slice(0, max);
}
