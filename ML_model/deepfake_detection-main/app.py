import os
import sys
import uuid
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
from flask_cors import CORS
from pathlib import Path

# Add project directory to sys.path
project_root = Path(__file__).resolve().parent
sys.path.append(str(project_root / "deepfake_project"))

from detector import DeepfakeDetector

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = project_root / 'uploads'
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv'}

# Ensure upload folder exists
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Initialize detector (loads model and scaler)
try:
    detector = DeepfakeDetector()
    print("Deepfake detector initialized successfully.")
except Exception as e:
    print(f"Error initializing detector: {e}")
    detector = None

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
    if detector is None:
        return jsonify({"success": False, "error": "Detector not initialized."}), 500
        
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file part"}), 400
        
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({"success": False, "error": "No selected file"}), 400
        
    if file and allowed_file(file.filename):
        # Create a unique filename to avoid collisions
        filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4()}_{filename}"
        filepath = UPLOAD_FOLDER / unique_filename
        file.save(str(filepath))
        
        try:
            # Perform prediction
            print(f"Starting analysis for: {filename}")
            result = detector.predict(filepath)
            
            # (Optional) Cleanup the uploaded file
            # os.remove(filepath) 
            
            return jsonify(result)
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        return jsonify({"success": False, "error": "File type not allowed."}), 400

if __name__ == '__main__':
    # For production, use a WSGI server like gunicorn or waitress
    # For local development:
    app.run(host='0.0.0.0', port=5000, debug=False)
