export interface AnalysisCategory {
  primary: string;
  secondary: string;
}

type CategoryRule = AnalysisCategory & { keywords: string[] };

const RULES: CategoryRule[] = [
  { primary: 'Excel 操作', secondary: '统计汇总', keywords: ['汇总', '统计', '求和', '合计', '均值', '计数', '分组', '聚合'] },
  { primary: 'Excel 操作', secondary: '数据清洗', keywords: ['清洗', '空值', '重复', '去重', '缺失', '异常值', '格式统一', '规范化'] },
  { primary: 'Excel 操作', secondary: '公式与计算', keywords: ['公式', '计算列', '增列', '函数', '占比', '环比', '同比计算'] },
  { primary: 'Excel 操作', secondary: '透视与合并', keywords: ['透视', '数据透视', '合并工作表', '合并表', '拆分', '分表', '关联'] },
  { primary: 'Excel 操作', secondary: '格式处理', keywords: ['日期格式', '数字格式', '百分比', '文本格式', '单位统一'] },
  { primary: '分析报告', secondary: '经营分析报告', keywords: ['经营分析', '经营报告', '经营总体', '经营情况'] },
  { primary: '分析报告', secondary: '趋势分析', keywords: ['趋势', '拐点', '走势', '增长率', '驱动因素'] },
  { primary: '分析报告', secondary: '预算执行', keywords: ['预算', '执行率', '预实', '差异分析', '预算完成'] },
  { primary: '分析报告', secondary: '业务结构', keywords: ['结构分析', '产品结构', '客户结构', '区域结构', '占比结构'] },
  { primary: '分析报告', secondary: '专项分析', keywords: ['专项', '专题', '专项分析', '专项报告'] },
  { primary: '分析报告', secondary: '管理层摘要', keywords: ['管理层', '一页纸', '摘要', '高管', 'executive'] },
  { primary: '数据核验', secondary: '对账与核验', keywords: ['对账', '对不上', '核对', '差多少', '为什么不一致', '靠谱吗', '经得起追问'] },
  { primary: '数据核验', secondary: '数据体检', keywords: ['体检', '这表', '脏数据', '有多少行是脏的', '表头识别'] },
];

export function inferAnalysisCategory(value: string): AnalysisCategory {
  const text = value.normalize('NFKC').toLocaleLowerCase('zh-CN');
  let best: CategoryRule | undefined;
  let score = 0;
  for (const rule of RULES) {
    const nextScore = rule.keywords.reduce(
      (total, keyword) => total + (text.includes(keyword) ? keyword.length : 0),
      0,
    );
    if (nextScore > score) {
      best = rule;
      score = nextScore;
    }
  }
  return best
    ? { primary: best.primary, secondary: best.secondary }
    : { primary: '综合分析', secondary: '一般咨询' };
}
