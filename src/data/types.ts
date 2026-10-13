export type ExampleVariant = {
  example: string;
  exampleZh: string;
};

export type Word = {
  term: string;
  phonetic: string;
  zh: string;
  category: string;
  level: string;
  definition: string;
  /** Chinese translation of the English definition */
  definitionZh?: string;
  collocation: string;
  example: string;
  exampleZh: string;
  /** Optional rotating example variants for flashcards / library */
  examples?: ExampleVariant[];
  source: string;
  sourceUrl: string;
  status?: string;
  priority?: string;
};

export type Progress = {
  profile: string;
  known: string[];
  learning: string[];
  saved: string[];
  wrong: string[];
  streak: number;
  lastStudy?: string;
  accent: 'us' | 'uk';
};

export const STORAGE_KEY = 'yg-english-progress-v1';
export const initialProgress = (): Progress => ({
  profile: '默认档案',
  known: [],
  learning: [],
  saved: [],
  wrong: [],
  streak: 0,
  accent: 'us',
});

export const ROLE_MAP: Record<string, string[]> = {
  外贸销售: ['水质指标', '传感器与分析仪', '远感产品', '外贸业务', '商务合作', '商务沟通', '销售表达', '售后服务', '标准与认证', '仪表性能'],
  技术支持: ['水质指标', '传感器与分析仪', '水处理工艺', '通信与数据', '售后服务', '安装与电气', '标准与认证', '采样与实验室', '计量与质控', '仪表性能', '运维', '测量原理'],
  研发产品: ['水质指标', '传感器与分析仪', '水处理工艺', '通信与数据', '安装与电气', '标准与认证', '采样与实验室', '计量与质控', '仪表性能', '测量原理', '远感产品'],
  智慧水务: ['智慧水务', '通信与数据', '水处理工艺', '商务合作', '采样与实验室', '水质指标'],
  泳池业务: ['游泳池水质', '水质指标', '传感器与分析仪', '商务合作', '标准与认证', '仪表性能', '消毒监测'],
};
