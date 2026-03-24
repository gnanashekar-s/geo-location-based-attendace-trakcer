"""
Celery application factory for the Geo-Attendance system.

Broker  : Redis DB 1  (CELERY_BROKER_URL)
Backend : Redis DB 2  (CELERY_RESULT_BACKEND)

Beat schedule
─────────────
  escalation_check    – every 5 minutes
  report_cleanup      – daily at 02:00 UTC
  geofence_watch      – every 2 minutes
  session_cleanup     – every 30 minutes
  buddy_punch_analysis – every 10 minutes
  user_risk_profiler  – daily at 03:00 UTC
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab
from kombu import Exchange, Queue

from app.config import settings

# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------

celery_app = Celery(
    "geo_attendance",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.tasks.escalation",
        "app.workers.tasks.reports",
        "app.workers.tasks.geofence_watch",
        "app.workers.tasks.cleanup",
        "app.workers.tasks.buddy_punch_analysis",
        "app.workers.tasks.user_risk_profiler",
    ],
)

# ---------------------------------------------------------------------------
# Core configuration
# ---------------------------------------------------------------------------

celery_app.conf.update(
    # Serialisation
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Timezone
    timezone="UTC",
    enable_utc=True,
    # Result expiry – keep results for 1 hour
    result_expires=3600,
    # Task execution limits
    task_soft_time_limit=300,   # 5 min soft limit → SoftTimeLimitExceeded
    task_time_limit=360,        # 6 min hard limit → SIGKILL
    # Retry / ack behaviour
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    # Routing
    task_default_queue="default",
    task_default_exchange="default",
    task_default_routing_key="default",
    # Queue definitions
    task_queues=(
        Queue("default",    Exchange("default"),    routing_key="default"),
        Queue("reports",    Exchange("reports"),    routing_key="reports"),
        Queue("escalation", Exchange("escalation"), routing_key="escalation"),
        Queue("geofence",   Exchange("geofence"),   routing_key="geofence"),
        Queue("fraud",      Exchange("fraud"),      routing_key="fraud"),
    ),
    # Route heavy report tasks to their own queue so they don't block lightweight tasks
    task_routes={
        "app.workers.tasks.reports.generate_csv_report": {"queue": "reports"},
        "app.workers.tasks.reports.generate_pdf_report": {"queue": "reports"},
        "app.workers.tasks.escalation.check_escalations": {"queue": "escalation"},
        "app.workers.tasks.geofence_watch.check_geofence_breaches": {"queue": "geofence"},
        "app.workers.tasks.buddy_punch_analysis.run_buddy_punch_analysis": {"queue": "fraud"},
        "app.workers.tasks.user_risk_profiler.update_user_risk_profiles": {"queue": "fraud"},
    },
)

# ---------------------------------------------------------------------------
# Beat schedule
# ---------------------------------------------------------------------------

celery_app.conf.beat_schedule = {
    # ── Approval SLA escalation: every 5 minutes ──────────────────────────
    "escalation_check": {
        "task": "app.workers.tasks.escalation.check_escalations",
        "schedule": 300.0,  # seconds
        "options": {"queue": "escalation"},
    },
    # ── Old report file cleanup: daily at 02:00 UTC ───────────────────────
    "report_cleanup": {
        "task": "app.workers.tasks.cleanup.cleanup_old_report_files",
        "schedule": crontab(hour=2, minute=0),
        "options": {"queue": "default"},
    },
    # ── Geofence breach detection: every 2 minutes ────────────────────────
    "geofence_watch": {
        "task": "app.workers.tasks.geofence_watch.check_geofence_breaches",
        "schedule": 120.0,
        "options": {"queue": "geofence"},
    },
    # ── Expired session cleanup: every 30 minutes ─────────────────────────
    "session_cleanup": {
        "task": "app.workers.tasks.cleanup.cleanup_expired_sessions",
        "schedule": 1800.0,
        "options": {"queue": "default"},
    },
    # ── Buddy punch fraud detection: every 10 minutes ─────────────────────
    "buddy_punch_analysis": {
        "task": "app.workers.tasks.buddy_punch_analysis.run_buddy_punch_analysis",
        "schedule": 600.0,
        "options": {"queue": "fraud"},
    },
    # ── User risk profile update: daily at 03:00 UTC ──────────────────────
    "user_risk_profiler": {
        "task": "app.workers.tasks.user_risk_profiler.update_user_risk_profiles",
        "schedule": crontab(hour=3, minute=0),
        "options": {"queue": "fraud"},
    },
}
