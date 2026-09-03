const ENGLISH_PROCESS_PATTERN = /\b(?:I have|I've|I will|I'll|I can|Now I|Now that|Let me|We need|I found|I confirmed|I should|Next,? I|Based on|With this|The next step)\b/i;

/** 上层 prompt 约定：最终答复前会有独立一行 `===最终答复===`。 */
export const FINAL_ANSWER_MARKER = '===最终答复===';

/** 匹配「最终答复」标记行或模型自述里的等价引导句（取最后一次出现之后的内容）。 */
const FINAL_ANSWER_BOUNDARY =
  /(?:^|\n)\s*(?:={2,}\s*)?(?:最终答复|最终回复|正式答复)(?:\s*={2,})?\s*[:：]?\s*(?:如下)?\s*[:：]?\s*(?=\n|$)/g;

/** <think> / <thinking> 包裹的推理，某些模型会用它输出思维链。 */
function stripThinkTags(value: string): string {
  return value.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/<\/?think(?:ing)?>/gi, '');
}

/**
 * 从模型最后一段 text 里剥出真正的「最终答复」。
 *
 * 弱模型（如 ds4f-0731-75）在报告模式下常把内部推理、自检算式和
 * 「现在写最终答复」这类过程文本，与最终答复拼在同一段 text 里输出。
 * 优先按上层约定的 `===最终答复===` 标记切分；无标记时退回到
 * 「最后一个引导句之后」或「第一个 Markdown 标题起」的启发式。
 */
export function extractFinalAnswer(value: string): string {
  const text = stripThinkTags(String(value || '').replace(/\r\n?/g, '\n'));

  let lastBoundaryEnd = -1;
  for (let m = FINAL_ANSWER_BOUNDARY.exec(text); m; m = FINAL_ANSWER_BOUNDARY.exec(text)) {
    lastBoundaryEnd = m.index + m[0].length;
  }
  FINAL_ANSWER_BOUNDARY.lastIndex = 0;
  if (lastBoundaryEnd >= 0) {
    const tail = text.slice(lastBoundaryEnd).trim();
    if (tail) return tail;
  }

  // 无引导句：报告体答复几乎总是以 Markdown 标题开头。若第一个标题前
  // 还堆了大段中文（典型是泄漏的思考/自检），就从该标题起截断。
  const heading = text.search(/(?:^|\n)#{1,4}\s+\S/);
  if (heading > 0) {
    const preambleHan = (text.slice(0, heading).match(/[一-鿿]/g) ?? []).length;
    if (preambleHan > 60) return text.slice(heading).trim();
  }

  return text.trim();
}

function paragraphs(value: string): string[] {
  return String(value || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
}

function isUrlOrCode(value: string): boolean {
  const trimmed = value.trim();
  return /^```[\s\S]*```$/.test(trimmed)
    || /^(?:https?:\/\/\S+|\[[^\]]+\]\(https?:\/\/[^)]+\))$/.test(trimmed);
}

export function isEnglishDominantProse(value: string): boolean {
  if (isUrlOrCode(value)) return false;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  const han = (value.match(/[\p{Script=Han}]/gu) ?? []).length;
  const englishWords = value.match(/\b[A-Za-z]{2,}\b/g)?.length ?? 0;
  return (latin >= 20 || englishWords >= 3) && latin > Math.max(12, han * 2);
}

export function removeEnglishProcessNarration(value: string): string {
  return paragraphs(value)
    .filter((paragraph) => !(isEnglishDominantProse(paragraph) && ENGLISH_PROCESS_PATTERN.test(paragraph)))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function containsEnglishProse(value: string): boolean {
  return paragraphs(value).some((paragraph) => isEnglishDominantProse(paragraph));
}

/**
 * chinese-output 翻译 agent 偶尔会在正文前加一句关于"转换/翻译"任务本身的
 * 开场白（如"好的，已收到…接下来我会将英文内容翻译转换为简体中文回复"）。
 * 只剥掉明确在描述转换动作的开头段落，普通答复开头（"已按要求完成…"）不受影响。
 */
export function stripTranslationPreamble(value: string): string {
  let out = String(value || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const meta =
    /^[^\n]*?(?:翻译(?:并|成|为|转换)|转换(?:为|成)(?:简体)?中文|转成中文|(?:简体)?中文(?:回复|答复|译文|版本)|英文(?:的)?(?:过程性?)?内容|合并整理(?:并)?翻译)[^\n]*\n+/;
  for (let i = 0; i < 2 && meta.test(out); i += 1) {
    out = out.replace(meta, '');
    out = out.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*\n+/, '');
  }
  return out.trimStart();
}

/** Never stream raw English prose; the finalized answer is translated separately. */
export function chineseLivePreview(value: string): string {
  let pendingTranslation = false;
  const visible = paragraphs(value).filter((paragraph) => {
    if (!isEnglishDominantProse(paragraph)) return true;
    if (!ENGLISH_PROCESS_PATTERN.test(paragraph)) pendingTranslation = true;
    return false;
  });
  if (pendingTranslation) visible.push('> 正在将外文内容转换为中文，请稍候。');
  return visible.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Fail closed when the translation runtime is unavailable. */
export function hideUntranslatedEnglish(value: string): string {
  let hidden = false;
  const visible = paragraphs(value).filter((paragraph) => {
    if (!isEnglishDominantProse(paragraph)) return true;
    hidden = true;
    return false;
  });
  if (hidden) visible.push('> 部分外文内容暂未完成中文转换，已停止展示。');
  return visible.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
