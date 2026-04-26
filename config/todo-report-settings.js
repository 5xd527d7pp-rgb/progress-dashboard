export const REPORT_TIMEZONE = 'Asia/Tokyo';

// 業務ごとの固定担当者マスタ
export const BUSINESS_ASSIGNEES = {
  '20260132': '渡辺',
  '20260139': '渡辺',
  '20260140': '長谷川',
  '20260141': '中嶋'
};

// 会議イベント後に必ず生成するルーティンタスク
export const ROUTINE_TASK_TEMPLATES = {
  review_committee: [
    { content: '議事録作成', instructionMethod: '会議' },
    { content: '指摘事項リスト作成', instructionMethod: '会議' }
  ],
  bunkacho_consultation: [
    { content: '議事録作成', instructionMethod: '会議' },
    { content: '指摘事項リスト作成', instructionMethod: '会議' }
  ]
};

// イベント実施日から提出期限までの日数
export const ROUTINE_SUBMISSION_DEADLINE_DAYS = 7;

export const DEFAULT_CLIENT_DEADLINE_HOUR = '18:00';

export const STATUS_LABELS = {
  completed: '完了',
  inProgress: '進行中'
};
