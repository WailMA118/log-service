#!/bin/bash
# مراقبة دورية لـ Postgres أثناء تنفيذ load test — يُستخدم لتأكيد فرضية
# GIN pending-list cleanup / checkpoint pressure (المرحلة 0 من خطة التشخيص)
# قبل تعديل أي إعداد فعلي.
#
# الاستخدام:
#   ./scripts/monitor.sh <عدد الثواني> > diagnosis.log
#
# يُشغَّل من جذر المشروع (بجانب docker-compose.yml)، ويجب أن يعمل
# بالتوازي الزمني مع تشغيل k6 (وليس قبله أو بعده)، مثال:
#
#   ./scripts/monitor.sh 70 > diagnosis.log &
#   sleep 2
#   k6 run load-60s.js
#
# لا يغيّر أي إعداد أو سلوك في قاعدة البيانات — قراءة فقط (SELECT).

DURATION=${1:-60}
END=$((SECONDS + DURATION))

# اقرأ بيانات الاتصال من env.example إن لم تكن معرّفة مسبقًا في البيئة
PG_USER=${POSTGRES_USER:-logs}
PG_DB=${POSTGRES_DB:-logs}

while [ $SECONDS -lt $END ]; do
  echo "=== $(date +%T) ==="

  echo "-- pg_stat_activity: أنماط الانتظار للاتصالات النشطة --"
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c "
    SELECT wait_event_type, wait_event, count(*)
    FROM pg_stat_activity
    WHERE state = 'active'
    GROUP BY 1,2;
  " 2>/dev/null

  echo "-- pg_stat_bgwriter: ضغط checkpoint --"
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c "
    SELECT checkpoints_timed, checkpoints_req, buffers_checkpoint, buffers_backend
    FROM pg_stat_bgwriter;
  " 2>/dev/null

  echo "-- حجم فهارس GIN (الدليل الحاسم لفرضية pending list) --"
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c "
    SELECT pg_size_pretty(pg_relation_size('logs_attributes_gin_idx')) AS attr_gin,
           pg_size_pretty(pg_relation_size('logs_message_trgm_idx')) AS msg_gin;
  " 2>/dev/null

  echo "-- pg_stat_wal: معدل وحجم WAL --"
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c "
    SELECT wal_records, wal_bytes, wal_write, wal_sync
    FROM pg_stat_wal;
  " 2>/dev/null

  sleep 2
done