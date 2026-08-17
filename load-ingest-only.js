/* global __ENV */
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

// ============================================================================
// إعدادات قابلة للتغيير عبر متغيرات بيئة (بدون تعديل السكريبت):
//   k6 run -e BASE_URL=http://localhost:8080 -e BATCH_SIZE=150 -e RATE=100 load-60s.js
//
// RATE هو عدد الطلبات (batches) في الثانية، وليس عدد السجلات.
// logs/sec الفعلي = RATE * BATCH_SIZE
// المثال الافتراضي: 100 * 150 = 15,000 logs/sec (نفس هدف المشروع)
// ============================================================================
const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const BATCH_SIZE = Number(__ENV.BATCH_SIZE || 150);
const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || "60s";

const accepted = new Counter("logs_accepted");
const rejected = new Counter("logs_rejected");

const SERVICES = ["checkout", "auth", "api", "worker", "payments"];
const LEVELS = ["debug", "info", "warn", "error"];

function randomLog() {
  return {
    timestamp: new Date().toISOString(),
    level: LEVELS[Math.floor(Math.random() * LEVELS.length)],
    service: SERVICES[Math.floor(Math.random() * SERVICES.length)],
    message: `k6 load test message ${Math.random().toString(36).slice(2)}`,
    attributes: {
      user_id: String(Math.floor(Math.random() * 100000)),
      region: "eu-west",
      retries: Math.floor(Math.random() * 5),
    },
  };
}

function buildBatch(size) {
  const logs = [];
  for (let i = 0; i < size; i++) logs.push(randomLog());
  return JSON.stringify({ logs });
}

export const options = {
  scenarios: {
    ingest: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.min(RATE * 3, 600),
      maxVUs: Math.min(RATE * 10, 1200),
      exec: "ingest",
    },
  },

  thresholds: {
    "http_req_duration{name:ingest}": ["p(95)<2000"],
    "http_req_failed{name:ingest}": ["rate<0.01"],
  },
};

export function ingest() {
  const res = http.post(`${BASE_URL}/logs`, buildBatch(BATCH_SIZE), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "ingest" },
  });

  const ok = check(res, { "status is 200": (r) => r.status === 200 });
  if (ok) {
    try {
      const body = JSON.parse(res.body);
      accepted.add(body.accepted || 0);
      rejected.add((body.rejected || []).length);
    } catch {
      // تجاهل فشل التحليل هنا؛ الفحص أعلاه يكفي لاكتشاف مشاكل الاستجابة
    }
  }
}

export function aggregate() {
  const until = new Date();
  const since = new Date(until.getTime() - 5 * 60 * 1000); // آخر 5 دقائق
  const url =
    `${BASE_URL}/logs/aggregate?since=${since.toISOString()}` +
    `&until=${until.toISOString()}&bucket=1m`;

  const res = http.get(url, { tags: { name: "aggregate" } });
  check(res, { "aggregate status is 200": (r) => r.status === 200 });
}