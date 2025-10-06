from flask import Blueprint, jsonify

apps_bp = Blueprint('apps', __name__)

@apps_bp.route('/')
def index():
    return jsonify({"message": "Apps extension is running"})
