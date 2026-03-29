import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, accuracy_score
import joblib
import os

def train_model(csv_path, model_dir):
    print(f"Loading dataset from {csv_path}...")
    df = pd.read_csv(csv_path)

    # Initial data info
    print(f"Total samples: {len(df)}")
    
    # Cleaning data: 
    # 1. Filter by success flags
    df_clean = df[(df['blink_success'] == True) & (df['headpose_success'] == True)].copy()
    
    # 2. Drop rows with invalid feature values (-1.0 often indicates extraction failure or no faces)
    features = [
        'total_blinks', 'blink_rate', 'avg_ear', 'ear_variance',
        'yaw_variance', 'pitch_variance', 'yaw_angular_velocity', 
        'pitch_angular_velocity', 'mean_yaw', 'mean_pitch'
    ]
    
    for feat in features:
        df_clean = df_clean[df_clean[feat] != -1.0]

    print(f"Samples after cleaning: {len(df_clean)}")
    
    if len(df_clean) < 10:
        print("Error: Not enough data after cleaning to train a model.")
        return

    # Prepare features and labels
    X = df_clean[features]
    y = df_clean['label'].apply(lambda x: 1 if x == 'fake' else 0) # 1 for Fake, 0 for Real

    # Split dataset
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    # Scaling
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Train Random Forest
    print("Training RandomForestClassifier...")
    clf = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    clf.fit(X_train_scaled, y_train)

    # Evaluation
    y_pred = clf.predict(X_test_scaled)
    acc = accuracy_score(y_test, y_pred)
    print(f"\nAccuracy: {acc:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))

    # Feature Importance
    importances = clf.feature_importances_
    indices = np.argsort(importances)[::-1]
    print("\nFeature Importances:")
    for f in range(X.shape[1]):
        print(f"{f + 1}. {features[indices[f]]} ({importances[indices[f]]:.4f})")

    # Save artifacts
    if not os.path.exists(model_dir):
        os.makedirs(model_dir)
        
    model_path = os.path.join(model_dir, 'detector_model.pkl')
    scaler_path = os.path.join(model_dir, 'scaler.pkl')
    
    joblib.dump(clf, model_path)
    joblib.dump(scaler, scaler_path)
    
    print(f"\nModel saved to {model_path}")
    print(f"Scaler saved to {scaler_path}")

if __name__ == "__main__":
    base_dir = r"d:\2)college folder\4th semister\EDI\ML_model\deepfake_detection-main\deepfake_project"
    csv_file = os.path.join(base_dir, "feature_extraction", "dataset_features.csv")
    output_dir = os.path.join(base_dir, "models")
    train_model(csv_file, output_dir)
