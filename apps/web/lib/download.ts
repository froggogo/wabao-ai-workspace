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

/**
 * 下载图片。同源资源（/uploads/**，经 Next rewrite 代理）先取 blob 再下载，
 * 这样能正确应用自定义文件名；失败时回退为直接打开链接。
 */
export async function downloadImage(url: string, name: string): Promise<void> {
  const ext = url.split(".").pop()?.split(/[?#]/)[0] || "png";
  const filename = `${safeFilename(name)}.${ext}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}
