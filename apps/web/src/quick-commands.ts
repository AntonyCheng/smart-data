import type { SessionMode } from './lib/api';

export type QuickCommandCategory = 'Excel 操作' | '分析报告';

export type QuickCommand = {
  title: string;
  description: string;
  category: QuickCommandCategory;
  mode: SessionMode;
  featured?: boolean;
  keywords: string;
  prompt: string;
};

export const QUICK_COMMAND_CATEGORIES: QuickCommandCategory[] = ['Excel 操作', '分析报告'];

export const QUICK_COMMANDS: QuickCommand[] = [
  {
    title: '统计汇总',
    description: '关键合计、均值和分组结果，并生成处理后的 Excel',
    category: 'Excel 操作',
    mode: 'operate',
    featured: true,
    keywords: '统计 汇总 合计 均值 分组 计数',
    prompt: '对当前数据做统计汇总，给出关键合计、均值和分组结果，并生成处理后的 Excel。我关注的口径和分组字段是：',
  },
  {
    title: '清洗空值与重复值',
    description: '检查并清洗空值、重复值和格式异常',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '清洗 空值 重复 去重 格式 异常',
    prompt: '检查并清洗当前数据中的空值、重复值和格式异常，生成处理后的 Excel，并说明每一步影响了多少行。',
  },
  {
    title: '新增公式计算列',
    description: '按需求补充计算列与公式',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '公式 计算列 增列 函数 占比 环比',
    prompt: '根据当前数据补充所需计算列与公式，并生成处理后的 Excel。我需要的计算列是：',
  },
  {
    title: '合并多个工作表',
    description: '按一致字段合并，保留来源标记',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '合并 工作表 sheet 拼接 来源',
    prompt: '按一致字段合并当前工作簿中的相关工作表，保留来源标记并生成新的 Excel。',
  },
  {
    title: '按条件拆分工作表',
    description: '根据指定字段或条件拆分数据',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '拆分 分表 分组 条件',
    prompt: '根据指定字段或条件拆分当前数据，并生成包含拆分结果的新 Excel。拆分字段是：',
  },
  {
    title: '生成透视汇总',
    description: '先确认行列值字段，再生成透视表',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '透视 数据透视 pivot 汇总',
    prompt: '根据当前数据生成透视汇总表；先确认合适的行、列和值字段，再生成新的 Excel。',
  },
  {
    title: '统一日期与数字格式',
    description: '统一日期、金额、百分比和文本格式',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '格式 日期 数字 百分比 单位',
    prompt: '检查并统一当前 Excel 的日期、金额、百分比和文本格式，生成处理后的 Excel。',
  },
  {
    title: '标记异常数据',
    description: '标出异常值、缺失值和逻辑冲突',
    category: 'Excel 操作',
    mode: 'operate',
    keywords: '异常 缺失 逻辑冲突 标记 校验',
    prompt: '检查当前数据中的异常值、缺失值和逻辑冲突，在 Excel 中增加标记和说明列。',
  },
  {
    title: '经营分析报告',
    description: '完整分析并生成结论、证据、图表和建议',
    category: '分析报告',
    mode: 'report',
    featured: true,
    keywords: '经营分析 报告 结论 图表 建议',
    prompt: '基于当前 Excel 完成经营分析，并生成包含结论、证据、图表和建议的完整报告。我的分析目标和重点问题是：',
  },
  {
    title: '趋势分析报告',
    description: '分析趋势、拐点与主要驱动因素',
    category: '分析报告',
    mode: 'report',
    featured: true,
    keywords: '趋势 拐点 驱动因素 走势',
    prompt: '完整分析当前数据的趋势、拐点与主要驱动因素，并生成趋势分析报告。',
  },
  {
    title: '预算执行报告',
    description: '对比预算与实际，分析差异及原因',
    category: '分析报告',
    mode: 'report',
    keywords: '预算 执行 预实 差异 完成率',
    prompt: '对比预算与实际执行情况，分析差异及原因，并生成预算执行报告。',
  },
  {
    title: '业务结构报告',
    description: '分析产品、客户或区域结构及其变化',
    category: '分析报告',
    mode: 'report',
    keywords: '结构 产品 客户 区域 占比',
    prompt: '分析产品、客户或区域结构及其变化，生成包含图表与建议的完整报告。',
  },
  {
    title: '专项分析报告',
    description: '围绕专项需求完整分析并生成报告',
    category: '分析报告',
    mode: 'report',
    keywords: '专项 专题 深度',
    prompt: '围绕我接下来提供的专项需求，完整分析数据并生成专项报告。专项需求是：',
  },
  {
    title: '管理层摘要',
    description: '完整分析并生成一页式管理层摘要',
    category: '分析报告',
    mode: 'report',
    keywords: '管理层 摘要 一页纸 高管',
    prompt: '完整分析当前数据，生成面向管理层的报告与一页式摘要。',
  },
];

export const FEATURED_COMMANDS = QUICK_COMMANDS.filter((command) => command.featured);
