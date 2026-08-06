# API Test Commands

استخدم الأوامر التالية لاختبار خدمة الـ logs المحلية. افترض أن التطبيق يعمل على `http://127.0.0.1:8080`.

## GET /health

```bash
curl -i http://127.0.0.1:8080/health
```

### متوقَّع
- إذا لم تكن الخدمة جاهزة: `503` مع JSON مثل:
  ```json
  { "status": "starting" }
  ```
- إذا كانت الخدمة جاهزة: `200` مع JSON مثل:
  ```json
  { "status": "ok" }
  ```

## POST /logs

إرسال دفعة سجلات صالحة:

```bash
curl -i -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "region": "eu-west",
        "retries": 3
      }
    }
  ]
}'
```

### متوقَّع
- `200` مع JSON مثل:
  ```json
  { "accepted": 1, "rejected": [] }
  ```

## POST /logs مع خطأ في البيانات

إرسال سجل غير صالح للتأكد من رد `400`:

```bash
curl -i -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {
        "timestamp": "not-a-timestamp",
        "level": "info",
        "service": "api",
        "message": "bad timestamp"
      }
    ]
  }'
```

## GET /logs

جلب سجلات بدون فلتر:

```bash
curl -i http://127.0.0.1:8080/logs
```

### فلترة حسب الخدمة

```bash
curl -i "http://127.0.0.1:8080/logs?service=api"
```

### فلترة حسب مستوى السجل

```bash
curl -i "http://127.0.0.1:3000/logs?level=info"
```

### فلترة بنطاق زمني

```bash
curl -i "http://127.0.0.1:3000/logs?since=2026-08-05T00:00:00.000Z&until=2026-08-06T00:00:00.000Z"
```

### طلب صفحة تالٍ باستخدام الكيرسور

```bash
curl -i "http://127.0.0.1:3000/logs?cursor=<NEXT_CURSOR>"
```

استبدل `<NEXT_CURSOR>` بالقيمة التي تحصل عليها من الحقل `next_cursor` في استجابة الصفحة السابقة.
