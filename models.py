from datetime import datetime, timezone

from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

# ---------- constants ----------
ROLES = ["OP", "P", "Serveringsansvarig", "CM", "ÖCM", "Sek", "ÖSek", "Medlem"]

ASSIGNMENT_ROLES = [
    "Serveringsansvarig",
    "Kontakt Krögare",
    "Providör Ansvarig",
    "Övrig Providör",
    "Rigga",
    "Röja",
]

CHECKLIST_PHASES = ["Inför Loge", "Kvällsstart", "Avslut & Efterstädning", "Dagen efter"]


# ---------- models ----------
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    display_name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(30), default="Medlem")  # organisational role
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class Meeting(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, unique=True)
    grad = db.Column(db.String(40), nullable=False)  # e.g. "IV", "B-Afton"
    notes = db.Column(db.Text, default="")
    assignments = db.relationship("Assignment", backref="meeting", cascade="all, delete-orphan")
    checklist_items = db.relationship("ChecklistItem", backref="meeting", cascade="all, delete-orphan")


class Assignment(db.Model):
    """Who does what at a specific meeting."""
    id = db.Column(db.Integer, primary_key=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey("meeting.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    role = db.Column(db.String(40), nullable=False)  # one of ASSIGNMENT_ROLES
    user = db.relationship("User")


class SwapRequest(db.Model):
    """A request to swap an assignment with someone else."""
    id = db.Column(db.Integer, primary_key=True)
    assignment_id = db.Column(db.Integer, db.ForeignKey("assignment.id"), nullable=False)
    requester_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    target_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)  # null = open request
    status = db.Column(db.String(20), default="pending")  # pending / accepted / declined
    message = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    assignment = db.relationship("Assignment")
    requester = db.relationship("User", foreign_keys=[requester_id])
    target = db.relationship("User", foreign_keys=[target_id])


class ChecklistItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey("meeting.id"), nullable=False)
    phase = db.Column(db.String(40), nullable=False)
    description = db.Column(db.String(300), nullable=False)
    responsible = db.Column(db.String(60), default="")
    when = db.Column(db.String(60), default="")
    done = db.Column(db.Boolean, default=False)
    done_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    done_by = db.relationship("User")


class InventoryItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(60), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    stock = db.Column(db.Float, default=0)
    unit = db.Column(db.String(30), default="flaskor")
