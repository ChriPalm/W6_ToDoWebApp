from datetime import date

from flask import Flask, abort, flash, redirect, render_template, request, url_for
from flask_login import LoginManager, current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash, generate_password_hash

from config import Config
from models import (
    ASSIGNMENT_ROLES,
    Assignment,
    ChecklistItem,
    InventoryItem,
    Meeting,
    SwapRequest,
    User,
    db,
)
from seed import seed_all


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)

    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.login_message = "Du måste logga in först."
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    # ── Auth ──────────────────────────────────────────────

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        if request.method == "POST":
            user = User.query.filter_by(username=request.form["username"]).first()
            if user and check_password_hash(user.password_hash, request.form["password"]):
                login_user(user)
                return redirect(request.args.get("next") or url_for("index"))
            flash("Fel användarnamn eller lösenord.", "danger")
        return render_template("login.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = request.form["username"].strip()
            display = request.form["display_name"].strip()
            pw = request.form["password"]
            if User.query.filter_by(username=username).first():
                flash("Användarnamnet är upptaget.", "danger")
            elif len(pw) < 3:
                flash("Lösenordet måste vara minst 3 tecken.", "danger")
            else:
                user = User(
                    username=username,
                    display_name=display,
                    password_hash=generate_password_hash(pw),
                )
                db.session.add(user)
                db.session.commit()
                login_user(user)
                flash(f"Välkommen {display}!", "success")
                return redirect(url_for("index"))
        return render_template("register.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        return redirect(url_for("login"))

    # ── Dashboard ─────────────────────────────────────────

    @app.route("/")
    @login_required
    def index():
        upcoming = Meeting.query.filter(Meeting.date >= date.today()).order_by(Meeting.date).all()
        my_assignments = (
            Assignment.query.filter_by(user_id=current_user.id)
            .join(Meeting)
            .filter(Meeting.date >= date.today())
            .order_by(Meeting.date)
            .all()
        )
        pending_swaps = SwapRequest.query.filter_by(target_id=current_user.id, status="pending").all()
        return render_template(
            "index.html",
            upcoming=upcoming,
            my_assignments=my_assignments,
            pending_swaps=pending_swaps,
        )

    # ── Schema (schedule) ─────────────────────────────────

    @app.route("/schema")
    @login_required
    def schema():
        meetings = Meeting.query.order_by(Meeting.date).all()
        return render_template("schema.html", meetings=meetings, roles=ASSIGNMENT_ROLES)

    @app.route("/meeting/<int:meeting_id>")
    @login_required
    def meeting_detail(meeting_id):
        meeting = db.session.get(Meeting, meeting_id) or abort(404)
        users = User.query.order_by(User.display_name).all()
        return render_template("meeting.html", meeting=meeting, users=users, roles=ASSIGNMENT_ROLES)

    # ── Signup / Assign ───────────────────────────────────

    @app.route("/signup/<int:assignment_id>", methods=["POST"])
    @login_required
    def signup(assignment_id):
        a = db.session.get(Assignment, assignment_id) or abort(404)
        if a.user_id is not None:
            flash("Den platsen är redan tagen.", "warning")
        else:
            a.user_id = current_user.id
            db.session.commit()
            flash(f"Du är nu anmäld som {a.role}!", "success")
        return redirect(url_for("meeting_detail", meeting_id=a.meeting_id))

    @app.route("/unassign/<int:assignment_id>", methods=["POST"])
    @login_required
    def unassign(assignment_id):
        a = db.session.get(Assignment, assignment_id) or abort(404)
        if a.user_id != current_user.id and current_user.role != "OP":
            flash("Du kan bara avanmäla dig själv.", "danger")
        else:
            a.user_id = None
            db.session.commit()
            flash("Avanmäld.", "info")
        return redirect(url_for("meeting_detail", meeting_id=a.meeting_id))

    @app.route("/assign/<int:assignment_id>", methods=["POST"])
    @login_required
    def assign_user(assignment_id):
        if current_user.role != "OP":
            abort(403)
        a = db.session.get(Assignment, assignment_id) or abort(404)
        uid = request.form.get("user_id")
        a.user_id = int(uid) if uid else None
        db.session.commit()
        flash("Uppdaterad.", "success")
        return redirect(url_for("meeting_detail", meeting_id=a.meeting_id))

    # ── Swap requests ─────────────────────────────────────

    @app.route("/swap/request/<int:assignment_id>", methods=["GET", "POST"])
    @login_required
    def swap_request(assignment_id):
        a = db.session.get(Assignment, assignment_id) or abort(404)
        if a.user_id != current_user.id:
            flash("Du kan bara byta dina egna pass.", "danger")
            return redirect(url_for("meeting_detail", meeting_id=a.meeting_id))
        if request.method == "POST":
            target_id = request.form.get("target_id")
            sr = SwapRequest(
                assignment_id=a.id,
                requester_id=current_user.id,
                target_id=int(target_id) if target_id else None,
                message=request.form.get("message", ""),
            )
            db.session.add(sr)
            db.session.commit()
            flash("Bytesförfrågan skickad!", "success")
            return redirect(url_for("meeting_detail", meeting_id=a.meeting_id))
        users = User.query.filter(User.id != current_user.id).order_by(User.display_name).all()
        return render_template("swap_request.html", assignment=a, users=users)

    @app.route("/swap/respond/<int:swap_id>", methods=["POST"])
    @login_required
    def swap_respond(swap_id):
        sr = db.session.get(SwapRequest, swap_id) or abort(404)
        action = request.form.get("action")
        if action == "accept":
            # swap the user on the assignment
            a = sr.assignment
            a.user_id = sr.target_id if sr.target_id else current_user.id
            sr.status = "accepted"
            db.session.commit()
            flash("Byte genomfört!", "success")
        elif action == "take":
            # open swap — anyone can take it
            a = sr.assignment
            a.user_id = current_user.id
            sr.target_id = current_user.id
            sr.status = "accepted"
            db.session.commit()
            flash("Du har tagit över passet!", "success")
        else:
            sr.status = "declined"
            db.session.commit()
            flash("Bytesförfrågan nekad.", "info")
        return redirect(url_for("index"))

    @app.route("/swaps")
    @login_required
    def swap_list():
        open_swaps = SwapRequest.query.filter_by(status="pending", target_id=None).all()
        my_incoming = SwapRequest.query.filter_by(status="pending", target_id=current_user.id).all()
        my_outgoing = SwapRequest.query.filter_by(requester_id=current_user.id).all()
        return render_template(
            "swaps.html",
            open_swaps=open_swaps,
            my_incoming=my_incoming,
            my_outgoing=my_outgoing,
        )

    # ── Checklists ────────────────────────────────────────

    @app.route("/checklist/<int:meeting_id>")
    @login_required
    def checklist(meeting_id):
        meeting = db.session.get(Meeting, meeting_id) or abort(404)
        items = ChecklistItem.query.filter_by(meeting_id=meeting_id).all()
        phases = {}
        for item in items:
            phases.setdefault(item.phase, []).append(item)
        return render_template("checklist.html", meeting=meeting, phases=phases)

    @app.route("/checklist/toggle/<int:item_id>", methods=["POST"])
    @login_required
    def checklist_toggle(item_id):
        item = db.session.get(ChecklistItem, item_id) or abort(404)
        item.done = not item.done
        item.done_by_id = current_user.id if item.done else None
        db.session.commit()
        return redirect(url_for("checklist", meeting_id=item.meeting_id))

    # ── Inventory ─────────────────────────────────────────

    @app.route("/lager")
    @login_required
    def inventory():
        items = InventoryItem.query.order_by(InventoryItem.category, InventoryItem.name).all()
        categories = {}
        for item in items:
            categories.setdefault(item.category, []).append(item)
        return render_template("inventory.html", categories=categories)

    @app.route("/lager/update/<int:item_id>", methods=["POST"])
    @login_required
    def inventory_update(item_id):
        item = db.session.get(InventoryItem, item_id) or abort(404)
        try:
            item.stock = float(request.form["stock"])
        except (ValueError, KeyError):
            flash("Ogiltigt värde.", "danger")
        else:
            db.session.commit()
            flash(f"{item.name} uppdaterad.", "success")
        return redirect(url_for("inventory"))

    # ── Init DB ───────────────────────────────────────────

    with app.app_context():
        db.create_all()
        seed_all(app)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
