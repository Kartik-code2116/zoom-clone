import os
import sys
from pathlib import Path

# Add project directory to sys.path
project_root = Path(__file__).resolve().parent
sys.path.append(str(project_root / "deepfake_project"))

from detector import DeepfakeDetector

def test_inference():
    try:
        detector = DeepfakeDetector()
        print("Successfully loaded model and scaler.")
        
        # Look for a sample video in the feature_extraction/videos directory if it exists
        video_dir = project_root / "deepfake_project" / "feature_extraction" / "videos"
        if not video_dir.exists():
            print(f"Video directory {video_dir} does not exist. Skipping inference test.")
            return
            
        videos = list(video_dir.glob("*.mp4")) + list(video_dir.glob("*.avi"))
        if not videos:
            print("No videos found in the video directory to test.")
            return
            
        test_video = videos[0]
        print(f"Testing inference on: {test_video}")
        
        result = detector.predict(test_video)
        print("\nDetection Result:")
        import json
        print(json.dumps(result, indent=4))
        
        if result.get("success"):
            print("\nSUCCESS: End-to-end detection pipeline is functional.")
        else:
            print(f"\nFAILURE: {result.get('error')}")
            
    except Exception as e:
        print(f"An error occurred during testing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_inference()
