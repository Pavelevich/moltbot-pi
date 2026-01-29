#!/usr/bin/env python3
"""
Display icon on Waveshare 1.44" LCD HAT (ST7735S)
For Raspberry Pi Zero 2W
"""

import st7735
from PIL import Image
import sys
import os

# Waveshare 1.44" LCD HAT pins
# RST = 27, DC = 25, BL = 24, CS = 8 (SPI CE0)

# Create display instance
disp = st7735.ST7735(
    port=0,
    cs=0,  # CE0
    dc=25,
    backlight=24,
    rst=27,
    width=128,
    height=128,
    rotation=0,
    invert=False,
    spi_speed_hz=4000000,
    offset_left=2,
    offset_top=1
)

# Initialize display
disp.begin()

def clear_display():
    """Clear display with black"""
    img = Image.new('RGB', (128, 128), (0, 0, 0))
    disp.display(img)

def show_image(image_path):
    """Display an image on the LCD"""

    if not os.path.exists(image_path):
        print(f'Error: {image_path} not found')
        sys.exit(1)

    # Clear first
    clear_display()

    # Load and resize image to fill entire display
    img = Image.open(image_path)
    img = img.resize((128, 128), Image.LANCZOS)

    # Convert to RGB if needed
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Display
    disp.display(img)
    print(f'Displaying: {image_path}')

def show_text(text, bg_color=(0, 0, 0), text_color=(255, 255, 255)):
    """Display text on screen"""
    from PIL import ImageDraw, ImageFont
    
    img = Image.new('RGB', (128, 128), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Use default font
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
    except:
        font = ImageFont.load_default()
    
    # Center text
    bbox = draw.textbbox((0, 0), text, font=font)
    x = (128 - (bbox[2] - bbox[0])) // 2
    y = (128 - (bbox[3] - bbox[1])) // 2
    
    draw.text((x, y), text, font=font, fill=text_color)
    disp.display(img)
    print(f'Displaying text: {text}')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        # Default: show Moltbot text
        show_text('MOLTBOT', bg_color=(30, 30, 60), text_color=(100, 200, 255))
    elif sys.argv[1].endswith(('.png', '.jpg', '.jpeg', '.bmp')):
        show_image(sys.argv[1])
    else:
        show_text(sys.argv[1])
