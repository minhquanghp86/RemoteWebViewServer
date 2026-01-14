#!/usr/bin/env python3
"""
Video Streaming Server for Remote WebView
Chạy song song với Node.js server để stream video từ HA camera
"""

import asyncio
import websockets
import json
import aiohttp
import base64
import logging
import os
import sys
from PIL import Image
from io import BytesIO

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [VIDEO] %(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)


class VideoServer:
    def __init__(self):
        self.port = int(os.getenv('VIDEO_PORT', '8082'))
        self.enabled = os.getenv('ENABLE_VIDEO', 'true').lower() == 'true'
        self.fps = int(os.getenv('VIDEO_FPS', '10'))
        self.quality = int(os.getenv('VIDEO_QUALITY', '70'))
        self.resolution = self._parse_resolution(os.getenv('VIDEO_RESOLUTION', '320x240'))
        self.camera_entity = os.getenv('VIDEO_CAMERA_ENTITY', '')
        
        self.clients = set()
        self.streaming = False
        
        # Home Assistant connection
        self.ha_url = os.getenv('HA_URL', 'http://supervisor/core')
        self.ha_token = os.getenv('SUPERVISOR_TOKEN', '')
        
        logger.info(f"Video Server Config: FPS={self.fps}, Quality={self.quality}, Resolution={self.resolution}")
    
    def _parse_resolution(self, res_str):
        """Parse '320x240' to (320, 240)"""
        try:
            w, h = res_str.split('x')
            return (int(w), int(h))
        except:
            logger.warning(f"Invalid resolution '{res_str}', using 320x240")
            return (320, 240)
    
    async def get_camera_frame(self, entity_id):
        """Lấy frame từ Home Assistant camera"""
        try:
            url = f"{self.ha_url}/api/camera_proxy/{entity_id}"
            headers = {
                "Authorization": f"Bearer {self.ha_token}",
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        return await resp.read()
                    else:
                        logger.error(f"Failed to get frame: HTTP {resp.status}")
                        return None
        except Exception as e:
            logger.error(f"Error getting camera frame: {e}")
            return None
    
    async def process_frame(self, frame_data):
        """Resize và compress frame"""
        try:
            # Load image
            img = Image.open(BytesIO(frame_data))
            
            # Resize
            if img.size != self.resolution:
                img = img.resize(self.resolution, Image.Resampling.LANCZOS)
            
            # Convert to JPEG
            output = BytesIO()
            img.save(output, format='JPEG', quality=self.quality, optimize=True)
            jpeg_data = output.getvalue()
            
            # Encode base64
            b64_data = base64.b64encode(jpeg_data).decode('utf-8')
            
            return {
                'type': 'video_frame',
                'data': b64_data,
                'width': self.resolution[0],
                'height': self.resolution[1]
            }
        except Exception as e:
            logger.error(f"Error processing frame: {e}")
            return None
    
    async def stream_loop(self):
        """Main streaming loop"""
        frame_delay = 1.0 / self.fps
        
        while self.streaming and self.clients:
            try:
                # Lấy frame
                frame_data = await self.get_camera_frame(self.camera_entity)
                
                if frame_data:
                    # Process frame
                    message = await self.process_frame(frame_data)
                    
                    if message:
                        # Gửi đến tất cả clients
                        message_str = json.dumps(message)
                        disconnected = set()
                        
                        for client in self.clients:
                            try:
                                await client.send(message_str)
                            except:
                                disconnected.add(client)
                        
                        # Remove disconnected clients
                        self.clients -= disconnected
                
                await asyncio.sleep(frame_delay)
                
            except Exception as e:
                logger.error(f"Error in stream loop: {e}")
                await asyncio.sleep(1)
    
    async def handle_client(self, websocket, path):
        """Xử lý WebSocket client"""
        client_addr = websocket.remote_address
        logger.info(f"Client connected: {client_addr}")
        
        self.clients.add(websocket)
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    msg_type = data.get('type')
                    
                    if msg_type == 'start_video':
                        entity_id = data.get('entity_id', self.camera_entity)
                        if entity_id:
                            self.camera_entity = entity_id
                            self.streaming = True
                            logger.info(f"Starting video stream: {entity_id}")
                            
                            # Bắt đầu streaming nếu chưa có
                            if not hasattr(self, 'stream_task') or self.stream_task.done():
                                self.stream_task = asyncio.create_task(self.stream_loop())
                            
                            await websocket.send(json.dumps({
                                'type': 'video_started',
                                'entity_id': entity_id
                            }))
                    
                    elif msg_type == 'stop_video':
                        self.streaming = False
                        logger.info("Stopping video stream")
                        
                        await websocket.send(json.dumps({
                            'type': 'video_stopped'
                        }))
                    
                    elif msg_type == 'ping':
                        await websocket.send(json.dumps({'type': 'pong'}))
                
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from {client_addr}")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
        
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client disconnected: {client_addr}")
        finally:
            self.clients.discard(websocket)
            
            # Stop streaming nếu không còn clients
            if not self.clients:
                self.streaming = False
    
    async def start(self):
        """Khởi động WebSocket server"""
        if not self.enabled:
            logger.info("Video streaming is disabled")
            return
        
        logger.info(f"Starting Video Server on port {self.port}")
        
        async with websockets.serve(self.handle_client, "0.0.0.0", self.port):
            logger.info(f"Video Server running on ws://0.0.0.0:{self.port}")
            await asyncio.Future()  # Run forever


async def main():
    server = VideoServer()
    await server.start()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Video Server stopped")
        sys.exit(0)
