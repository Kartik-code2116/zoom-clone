"""
Optimized Dataset Builder for Behavioral Deepfake Detection.

Processes videos in parallel using multiprocessing to extract:
- Blink features (EAR, blink rate)
- Head pose features (yaw/pitch variance, angular velocity)

Saves results to dataset_features.csv
"""

import cv2
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing
import time
import warnings
from functools import partial
import traceback

warnings.filterwarnings('ignore')

# Import optimized modules
from blink_test import BlinkDetector
from headpose_test import RobustHeadPoseEstimator


class FeatureExtractor:
    """
    Wrapper class to combine blink and head pose feature extraction.
    Used as a callable for multiprocessing.
    """
    
    def __init__(self, blink_frame_skip: int = 2, headpose_frame_skip: int = 2):
        """
        Initialize feature extractor with frame skip parameters.
        
        Args:
            blink_frame_skip: Frame skip for blink detection
            headpose_frame_skip: Frame skip for head pose estimation
        """
        self.blink_frame_skip = blink_frame_skip
        self.headpose_frame_skip = headpose_frame_skip
    
    def __call__(self, video_path: Path, label: str) -> Optional[Dict]:
        """
        Extract all features from a single video.
        
        Args:
            video_path: Path to video file
            label: 'real' or 'fake'
            
        Returns:
            Dictionary with all features or None if extraction fails
        """
        return extract_video_features(video_path, label, 
                                     self.blink_frame_skip, 
                                     self.headpose_frame_skip)


def extract_video_features(
    video_path: Path, 
    label: str,
    blink_frame_skip: int = 2,
    headpose_frame_skip: int = 2
) -> Optional[Dict]:
    """
    Extract both blink and head pose features from a single video.
    
    Args:
        video_path: Path to video file
        label: 'real' or 'fake'
        blink_frame_skip: Frame skip for blink detection
        headpose_frame_skip: Frame skip for head pose estimation
        
    Returns:
        Dictionary with combined features or None if extraction fails
    """
    try:
        video_name = video_path.name
        
        # Initialize detectors
        blink_detector = BlinkDetector(static_image_mode=False, 
                                       frame_skip=blink_frame_skip)
        headpose_estimator = RobustHeadPoseEstimator(static_image_mode=False,
                                                     frame_skip=headpose_frame_skip)
        
        # Extract blink features
        blink_result = blink_detector.process_video(video_path)
        
        # Extract head pose features
        headpose_result = headpose_estimator.process_video(video_path)
        
        # If both failed, return None
        if blink_result is None and headpose_result is None:
            return None
        
        # Combine results
        combined = {
            'video_path': video_name,
            'label': label
        }
        
        # Add blink features if available
        if blink_result is not None:
            combined.update({
                'total_blinks': blink_result.get('total_blinks', 0),
                'blink_rate': blink_result.get('blink_rate', 0.0),
                'avg_ear': blink_result.get('avg_ear', 0.0),
                'ear_variance': blink_result.get('ear_variance', 0.0),
                'blink_frames_processed': blink_result.get('frames_processed', 0),
                'blink_faces_detected': blink_result.get('faces_detected', 0)
            })
        else:
            combined.update({
                'total_blinks': -1,
                'blink_rate': -1.0,
                'avg_ear': -1.0,
                'ear_variance': -1.0,
                'blink_frames_processed': 0,
                'blink_faces_detected': 0
            })
        
        # Add head pose features if available
        if headpose_result is not None:
            combined.update({
                'yaw_variance': headpose_result.get('yaw_variance', 0.0),
                'pitch_variance': headpose_result.get('pitch_variance', 0.0),
                'roll_variance': headpose_result.get('roll_variance', 0.0),
                'yaw_angular_velocity': headpose_result.get('yaw_angular_velocity', 0.0),
                'pitch_angular_velocity': headpose_result.get('pitch_angular_velocity', 0.0),
                'roll_angular_velocity': headpose_result.get('roll_angular_velocity', 0.0),
                'mean_yaw': headpose_result.get('mean_yaw', 0.0),
                'mean_pitch': headpose_result.get('mean_pitch', 0.0),
                'mean_roll': headpose_result.get('mean_roll', 0.0),
                'headpose_frames_processed': headpose_result.get('frames_processed', 0),
                'headpose_faces_detected': headpose_result.get('faces_detected', 0),
                'duration': headpose_result.get('duration', 0.0)
            })
        else:
            combined.update({
                'yaw_variance': -1.0,
                'pitch_variance': -1.0,
                'roll_variance': -1.0,
                'yaw_angular_velocity': -1.0,
                'pitch_angular_velocity': -1.0,
                'roll_angular_velocity': -1.0,
                'mean_yaw': -1.0,
                'mean_pitch': -1.0,
                'mean_roll': -1.0,
                'headpose_frames_processed': 0,
                'headpose_faces_detected': 0,
                'duration': 0.0
            })
        
        return combined
        
    except Exception as e:
        print(f"Error processing {video_path.name}: {str(e)}")
        traceback.print_exc()
        return None


def process_videos_parallel(
    video_paths: List[Tuple[Path, str]],
    num_workers: int = 4,
    blink_frame_skip: int = 2,
    headpose_frame_skip: int = 2
) -> List[Dict]:
    """
    Process videos in parallel using ProcessPoolExecutor.
    
    Args:
        video_paths: List of (video_path, label) tuples
        num_workers: Number of parallel processes
        blink_frame_skip: Frame skip for blink detection
        headpose_frame_skip: Frame skip for head pose estimation
        
    Returns:
        List of result dictionaries
    """
    results = []
    total_videos = len(video_paths)
    
    print(f"Processing {total_videos} videos with {num_workers} workers...")
    print(f"Frame skip: blink={blink_frame_skip}, headpose={headpose_frame_skip}")
    
    # Create extractor with fixed parameters
    extractor = FeatureExtractor(blink_frame_skip, headpose_frame_skip)
    
    start_time = time.time()
    completed = 0
    failed = 0
    
    # Use ProcessPoolExecutor for parallel processing
    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        # Submit all tasks
        future_to_video = {
            executor.submit(extractor, video_path, label): (video_path, label)
            for video_path, label in video_paths
        }
        
        # Process as they complete
        for future in as_completed(future_to_video):
            video_path, label = future_to_video[future]
            completed += 1
            
            try:
                result = future.result(timeout=120)  # 2 minute timeout per video
                if result is not None:
                    results.append(result)
                else:
                    failed += 1
                    print(f"  ✗ {video_path.name}: Extraction failed (no features)")
            except Exception as e:
                failed += 1
                print(f"  ✗ {video_path.name}: Error - {str(e)[:50]}")
            
            # Progress update
            if completed % 10 == 0 or completed == total_videos:
                elapsed = time.time() - start_time
                rate = completed / elapsed if elapsed > 0 else 0
                print(f"  Progress: {completed}/{total_videos} "
                      f"({rate:.1f} videos/sec) - "
                      f"Success: {len(results)}, Failed: {failed}")
    
    elapsed = time.time() - start_time
    print(f"\nCompleted in {elapsed:.1f} seconds")
    print(f"Successfully processed: {len(results)}/{total_videos} videos")
    
    return results


def main():
    """Main function to build the dataset."""
    
    # Configuration
    NUM_WORKERS = min(6, multiprocessing.cpu_count())  # Max 6 workers
    BLINK_FRAME_SKIP = 2  # Process every 2nd frame for blink
    HEADPOSE_FRAME_SKIP = 2  # Process every 2nd frame for head pose
    
    # Define paths
    script_dir = Path(__file__).parent.absolute()
    data_dir = script_dir.parent / 'data'
    output_csv = script_dir / 'dataset_features.csv'
    
    real_dir = data_dir / 'real'
    fake_dir = data_dir / 'fake'
    
    # Validate directories
    if not real_dir.exists() or not fake_dir.exists():
        print(f"Error: Data directories not found")
        print(f"Expected: {real_dir} and {fake_dir}")
        return
    
    # Collect all video paths with labels
    video_paths = []
    
    # Real videos
    real_videos = list(real_dir.glob('*.mp4'))
    video_paths.extend([(path, 'real') for path in real_videos])
    print(f"Found {len(real_videos)} real videos")
    
    # Fake videos
    fake_videos = list(fake_dir.glob('*.mp4'))
    video_paths.extend([(path, 'fake') for path in fake_videos])
    print(f"Found {len(fake_videos)} fake videos")
    print(f"Total: {len(video_paths)} videos\n")
    
    if len(video_paths) == 0:
        print("No videos found to process.")
        return
    
    # Process videos in parallel
    results = process_videos_parallel(
        video_paths,
        num_workers=NUM_WORKERS,
        blink_frame_skip=BLINK_FRAME_SKIP,
        headpose_frame_skip=HEADPOSE_FRAME_SKIP
    )
    
    if len(results) == 0:
        print("No videos were successfully processed.")
        return
    
    # Create DataFrame and save
    df = pd.DataFrame(results)
    
    # Add success flags
    df['blink_success'] = (df['blink_frames_processed'] > 0)
    df['headpose_success'] = (df['headpose_frames_processed'] > 0)
    
    # Reorder columns for readability
    column_order = [
        'video_path', 'label',
        'total_blinks', 'blink_rate', 'avg_ear', 'ear_variance',
        'yaw_variance', 'pitch_variance', 'roll_variance',
        'yaw_angular_velocity', 'pitch_angular_velocity', 'roll_angular_velocity',
        'mean_yaw', 'mean_pitch', 'mean_roll', 'duration',
        'blink_frames_processed', 'headpose_frames_processed',
        'blink_faces_detected', 'headpose_faces_detected',
        'blink_success', 'headpose_success'
    ]
    
    # Only include columns that exist
    existing_columns = [col for col in column_order if col in df.columns]
    df = df[existing_columns]
    
    # Save to CSV
    df.to_csv(output_csv, index=False)
    print(f"\n✅ Dataset saved to: {output_csv}")
    print(f"   Shape: {df.shape[0]} rows × {df.shape[1]} columns")
    
    # Print summary statistics
    print("\n" + "="*50)
    print("DATASET SUMMARY")
    print("="*50)
    
    real_success = df[df['label'] == 'real']
    fake_success = df[df['label'] == 'fake']
    
    print(f"Real videos successfully processed: {len(real_success)}/{len(real_videos)}")
    print(f"Fake videos successfully processed: {len(fake_success)}/{len(fake_videos)}")
    
    if len(real_success) > 0:
        print(f"\nReal videos - Avg blink rate: {real_success['blink_rate'].mean():.1f}/min")
        print(f"Real videos - Avg yaw variance: {real_success['yaw_variance'].mean():.1f}")
    
    if len(fake_success) > 0:
        print(f"\nFake videos - Avg blink rate: {fake_success['blink_rate'].mean():.1f}/min")
        print(f"Fake videos - Avg yaw variance: {fake_success['yaw_variance'].mean():.1f}")


if __name__ == "__main__":
    # Required for multiprocessing on Windows
    multiprocessing.freeze_support()
    main()
