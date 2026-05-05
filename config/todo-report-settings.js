export const REPORT_TIMEZONE = 'Asia/Tokyo';

// 業務ごとの固定担当者マスタ
export const BUSINESS_ASSIGNEES = {
  '20250504': '長谷川渚',
  '20260132': '渡邊',
  '20260139': '渡辺',
  '20260140': '長谷川',
  '20260141': '中嶋'
};

// 表記ゆれを既存業務へ寄せるための別名ルール
export const BUSINESS_NAME_ALIASES = [
  {
    keyword: '名勝地総合調査',
    businessId: '20250504',
    businessName: '令和８年度名勝地総合調査業務委託'
  },
  {
    keyword: '四條畷市文化財保存活用地域計画策定支援業務委託',
    businessId: '20260141',
    businessName: '四條畷市文化財保存活用地域計画策定支援業務委託（２年目）'
  },
  {
    keyword: '日高市',
    businessId: '20260132',
    businessName: '日高市文化財保存活用地域計画作成支援業務'
  },
  {
    keyword: '日髙市',
    businessId: '20260132',
    businessName: '日高市文化財保存活用地域計画作成支援業務'
  },
  {
    keyword: '史跡坊の塚古墳保存活用計画作成支援業務委託',
    businessId: '20260139',
    businessName: '史跡坊の塚古墳保存活用計画作成支援業務委託'
  },
  {
    keyword: '史跡舟木遺跡整備基本計画策定支援業務',
    businessId: '20260140',
    businessName: '史跡舟木遺跡整備基本計画策定支援業務（２年目）'
  }
];

// 会議イベント後に必ず生成するルーティンタスク
export const ROUTINE_TASK_TEMPLATES = {
  review_committee: [
    { content: '議事録作成', instructionMethod: '会議' },
    { content: '指摘事項リスト作成', instructionMethod: '会議' }
  ],
  bunkacho_consultation: [
    { content: '議事録作成', instructionMethod: '会議' },
    { content: '指摘事項リスト作成', instructionMethod: '会議' }
  ],
  /** 初回打合せ前までの準備（期限はイベントの客先資料提出期限、なければ開催前日） */
  kickoff_meeting: [
    { content: '業務計画書（案）の作成', instructionMethod: '打合せ' }
  ]
};

// イベント実施日から提出期限までの日数
export const ROUTINE_SUBMISSION_DEADLINE_DAYS = 7;

export const DEFAULT_CLIENT_DEADLINE_HOUR = '18:00';

export const STATUS_LABELS = {
  completed: '完了',
  inProgress: '進行中'
};
