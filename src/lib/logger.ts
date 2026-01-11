/**
 * Dashboard 用構造化ロガー
 *
 * Bot側のwinstonロガーに倣った実装だが、Dashboard（Astro SSR）環境では
 * ファイル出力をシンプルにするため、winston-daily-rotate-fileは使わない。
 * 代わりに標準のwinstonのみを使用し、Dockerログとして出力する。
 */

import winston from "winston";

// ログレベル
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// コンソール用フォーマット（色付き）
const consoleFormat = winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
  const contextStr = context ? `[${context}]` : "";
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level.toUpperCase()}] ${contextStr} ${message}${metaStr}`;
});

// JSON フォーマット（ファイル出力・構造化ログ用）
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// トランスポート設定
const transports: winston.transport[] = [
  // コンソール出力（色付き、人間可読）
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.colorize(),
      consoleFormat
    ),
  }),
];

// 本番環境ではJSON形式のログもコンソールに出力（Docker logs で収集）
if (process.env.NODE_ENV === "production") {
  transports.push(
    new winston.transports.Console({
      format: jsonFormat,
      level: "info", // 本番はinfo以上のみ構造化ログに出力
    })
  );
}

// Logger インスタンス作成
const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports,
  // エラー発生時に例外をスローしない（ロギング失敗でアプリを止めない）
  exitOnError: false,
});

// ヘルパー関数（context付きロギング）
export const createLogger = (context: string) => ({
  info: (message: string, meta?: Record<string, unknown>) => logger.info(message, { context, ...meta }),
  warn: (message: string, meta?: Record<string, unknown>) => logger.warn(message, { context, ...meta }),
  error: (message: string, meta?: Record<string, unknown>) => logger.error(message, { context, ...meta }),
  debug: (message: string, meta?: Record<string, unknown>) => logger.debug(message, { context, ...meta }),
});

export default logger;
