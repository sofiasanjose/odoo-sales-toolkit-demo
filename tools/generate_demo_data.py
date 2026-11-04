#!/usr/bin/env python3
"""
Generate the demo dataset for the Odoo Sales Toolkit.

Everything here is invented: the company (Puerto Sabor Foods S.L.), its
brands, customers, prices, orders and stock. It is shaped exactly like what
`odoo_sync.py` pulls from a real Odoo database, so the web app cannot tell the
difference, and nobody's real commercial data ends up in a public repo.

The simulation is deterministic (fixed seed) and tries to behave like a real
specialty-food importer in Spain:

* ~210 products from 10 origin countries, each with pack data (units per case,
  cases per pallet, case weight, EAN), landed cost, list price, VAT rate and
  shelf life.
* ~90 customers of six kinds (supermarket chains, specialty shops, restaurants,
  online shops, cash & carry, export) with their own price list, sales rep,
  payment terms and delivery addresses.
* Two years of sales orders. Each customer has a "core basket" that drifts over
  time (they try new launches, drop products, a few stop ordering altogether),
  order rhythm depends on the kind of customer, and demand follows real
  seasonality: drinks peak in summer, candy at Halloween and Christmas, and
  Spain slows down in August.
* Current stock with lots and best-before dates, reservations from confirmed
  orders, and inbound purchase orders (containers) with ETAs.

EANs use the GS1 restricted-circulation range (prefix 2xx) so they can never
collide with a real product's barcode.

Usage:  python3 tools/generate_demo_data.py            -> data/demo-data.js
"""
from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SEED = 20261104
TODAY = date(2026, 11, 4)
START = date(2024, 11, 1)
OUT = Path(__file__).resolve().parent.parent / "data" / "demo-data.js"

rng = random.Random(SEED)

# --------------------------------------------------------------------------
# Taxonomy
# --------------------------------------------------------------------------
CATEGORY_OF = {
    "Hot Sauces": "Sauces & Condiments",
    "Cooking Sauces & Moles": "Sauces & Condiments",
    "BBQ & Marinades": "Sauces & Condiments",
    "Asian Sauces": "Sauces & Condiments",
    "Curry & Chili Pastes": "Sauces & Condiments",
    "Tortillas & Tostadas": "Pantry",
    "Flours & Masa": "Pantry",
    "Rice & Grains": "Pantry",
    "Canned Chiles & Vegetables": "Pantry",
    "Beans & Pulses": "Pantry",
    "Spices & Seasonings": "Pantry",
    "Coconut Milk & Cream": "Pantry",
    "Instant Noodles": "Pantry",
    "Chips & Totopos": "Snacks",
    "Seaweed & Rice Snacks": "Snacks",
    "Biscuits & Cookies": "Snacks",
    "Candy": "Confectionery",
    "Chocolate": "Confectionery",
    "Mochi & Asian Sweets": "Confectionery",
    "Desserts & Dulce de Leche": "Confectionery",
    "Soft Drinks": "Beverages",
    "Energy Drinks": "Beverages",
    "Juices & Nectars": "Beverages",
    "Asian Drinks": "Beverages",
    "Coffee & Tea": "Beverages",
    "Breakfast Cereals": "Breakfast",
    "Pancakes & Syrups": "Breakfast",
    "Displays & POS": "Non-food",
}

SEASON = {  # monthly demand index, Jan..Dec
    "Beverages":           [0.74, 0.76, 0.86, 0.96, 1.12, 1.32, 1.42, 1.22, 1.04, 0.90, 0.84, 0.96],
    "Confectionery":       [0.86, 0.94, 0.90, 0.96, 0.90, 0.84, 0.84, 0.78, 0.98, 1.36, 1.12, 1.30],
    "Snacks":              [0.88, 0.90, 0.94, 0.98, 1.02, 1.10, 1.14, 1.00, 1.00, 1.04, 0.98, 1.10],
    "Sauces & Condiments": [0.94, 0.94, 1.00, 1.02, 1.08, 1.04, 1.00, 0.90, 1.00, 1.00, 1.00, 1.12],
    "Pantry":              [1.00, 0.96, 1.00, 1.00, 1.04, 0.98, 0.96, 0.88, 1.02, 1.04, 1.02, 1.12],
    "Breakfast":           [1.08, 1.00, 1.00, 0.98, 0.96, 0.94, 0.92, 0.90, 1.08, 1.04, 1.00, 1.06],
    "Non-food":            [1.0] * 12,
}

# --------------------------------------------------------------------------
# Brands and product lines
# (subcategory, pack shape, product word, size, unit, units/case, list price,
#  cost ratio, base velocity units/month, variants, extras)
# --------------------------------------------------------------------------
def L(sub, pack, word, size, unit, upc, price, cost, vel, variants, **kw):
    return dict(sub=sub, pack=pack, word=word, size=size, unit=unit, upc=upc,
                price=price, cost=cost, vel=vel, variants=variants, **kw)

ORANGE, RED, GREEN, BROWN, YEL, PURPLE, PINK, BLUE, TEAL, BLACK, CREAM = (
    "#E8590C", "#C92A2A", "#2F9E44", "#7A3E1D", "#F2B705", "#7048E8",
    "#E64980", "#1C7ED6", "#0C8599", "#212529", "#F1E3C8")

SUPPLIERS = {
    "MX1": ("Exportadora del Bajío S.A. de C.V.", "Mexico", "sea", 46),
    "MX2": ("Alimentos Sierra Madre S.A. de C.V.", "Mexico", "sea", 46),
    "US1": ("Great Lakes Food Export LLC", "United States", "sea", 38),
    "JP1": ("Kansai Trading Co., Ltd.", "Japan", "sea", 52),
    "KR1": ("Hanbit Global Foods Co., Ltd.", "South Korea", "sea", 48),
    "TH1": ("Siam Agro Export Co., Ltd.", "Thailand", "sea", 44),
    "PE1": ("Andina Export S.A.C.", "Peru", "sea", 34),
    "BR1": ("Raiz Tropical Exportação Ltda.", "Brazil", "sea", 30),
    "CO1": ("Comercializadora Cafetera del Valle S.A.S.", "Colombia", "sea", 28),
    "IN1": ("Malabar Spice Exports Pvt. Ltd.", "India", "sea", 40),
    "UK1": ("Thames Valley Foods Ltd.", "United Kingdom", "road", 9),
    "ES1": ("Cartonajes Getafe S.L.", "Spain", "road", 5),
}

BRANDS = [
    # ---------------------------------------------------------------- Mexico
    dict(name="Doña Lupe", origin="Mexico", sup="MX1", color="#B3261E", accent="#F4C542", lines=[
        L("Hot Sauces", "bottle_slim", "Hot Sauce", 150, "ml", 24, 1.45, .50, 1150,
          [("Clásica", RED), ("Habanero", ORANGE), ("Chipotle", BROWN), ("Verde", GREEN), ("Mango Habanero", "#F08C00")]),
        L("Hot Sauces", "bottle", "Hot Sauce", 370, "ml", 12, 2.35, .50, 420, [("Clásica", RED), ("Habanero", ORANGE)]),
        L("Hot Sauces", "jug", "Hot Sauce Catering", 3.78, "L", 4, 11.90, .47, 70, [("Clásica", RED)], horeca=True),
        L("Cooking Sauces & Moles", "jar", "Mole", 235, "g", 12, 2.95, .47, 240, [("Poblano", BROWN), ("Negro", BLACK), ("Verde", GREEN)]),
        L("Cooking Sauces & Moles", "jar", "Salsa Taquera", 453, "g", 12, 2.65, .49, 300, [("Roja", RED), ("Verde", GREEN)]),
    ]),
    dict(name="Milpa Real", origin="Mexico", sup="MX1", color="#2B8A3E", accent="#FFD43B", lines=[
        L("Tortillas & Tostadas", "flatpack", "Corn Tortillas 15 cm", 500, "g", 20, 1.85, .46, 1500, [("Yellow Corn", YEL), ("White Corn", CREAM)], shelf=150),
        L("Tortillas & Tostadas", "flatpack", "Flour Tortillas 20 cm", 1, "kg", 12, 3.40, .48, 520, [("Original", CREAM)], shelf=120, horeca=True),
        L("Tortillas & Tostadas", "flatpack", "Flour Tortillas 30 cm", 1.1, "kg", 10, 4.10, .48, 260, [("Burrito", CREAM)], shelf=120, horeca=True),
        L("Tortillas & Tostadas", "flatpack", "Tostadas", 360, "g", 16, 2.20, .45, 480, [("Horneadas", YEL), ("Raspadas", "#E9B949")]),
        L("Flours & Masa", "sack", "Masa Harina", 1, "kg", 10, 1.90, .44, 640, [("White Corn", CREAM), ("Blue Corn", "#364FC7")], vat=4),
        L("Flours & Masa", "sack", "Masa Harina", 4.5, "kg", 4, 7.20, .44, 120, [("White Corn", CREAM)], vat=4, horeca=True),
    ]),
    dict(name="El Charro Fino", origin="Mexico", sup="MX2", color="#1864AB", accent="#E03131", lines=[
        L("Canned Chiles & Vegetables", "tin", "Sliced Jalapeños", 220, "g", 24, 1.10, .48, 980, [("Nachos", GREEN)], shelf=1080),
        L("Canned Chiles & Vegetables", "tin", "Whole Jalapeños", 800, "g", 12, 2.80, .48, 260, [("En Escabeche", GREEN)], shelf=1080),
        L("Canned Chiles & Vegetables", "tin_big", "Sliced Jalapeños", 2.8, "kg", 6, 7.90, .46, 140, [("Nachos", GREEN)], shelf=1080, horeca=True),
        L("Canned Chiles & Vegetables", "tin", "Chipotles in Adobo", 215, "g", 24, 1.55, .47, 560, [("Adobo", BROWN)], shelf=1080),
        L("Canned Chiles & Vegetables", "tin_big", "Chipotles in Adobo", 2.8, "kg", 6, 12.40, .46, 60, [("Adobo", BROWN)], shelf=1080, horeca=True),
        L("Beans & Pulses", "tin", "Refried Beans", 430, "g", 12, 1.35, .45, 600, [("Pinto", BROWN), ("Black", BLACK)], shelf=900),
    ]),
    dict(name="Cielo Azul", origin="Mexico", sup="MX2", color="#1971C2", accent="#FFFFFF", lines=[
        L("Soft Drinks", "glass", "Soda", 355, "ml", 24, 0.95, .52, 2300,
          [("Tamarindo", BROWN), ("Mandarina", ORANGE), ("Jamaica", "#A61E4D"), ("Toronja", PINK), ("Piña", YEL), ("Limón", GREEN)], vat=21, shelf=360),
        L("Soft Drinks", "glass", "Agua Mineral", 355, "ml", 24, 0.85, .50, 600, [("Natural", BLUE), ("Limón", GREEN)], vat=10, shelf=540),
    ]),
    dict(name="Picosito", origin="Mexico", sup="MX2", color="#F03E3E", accent="#FCC419", lines=[
        L("Candy", "bag", "Chili Lollipops", 100, "g", 24, 1.60, .44, 820, [("Tamarindo", BROWN), ("Mango", "#F59F00"), ("Sandía", PINK)], vat=10, shelf=540),
        L("Candy", "bag", "Chili Gummies", 120, "g", 24, 1.75, .44, 900, [("Mango Chamoy", "#F59F00"), ("Sandía", PINK), ("Piña", YEL)], shelf=365),
        L("Candy", "box", "Tamarind Rolls Display", 40, "u", 12, 5.80, .45, 260, [("Original", BROWN)], shelf=365),
    ]),
    dict(name="Tostaditas Sol", origin="Mexico", sup="MX1", color="#F59F00", accent="#C92A2A", lines=[
        L("Chips & Totopos", "bag", "Totopos", 400, "g", 12, 2.40, .47, 760, [("Salted", YEL), ("Lime", GREEN)], shelf=180),
        L("Chips & Totopos", "bag", "Chips", 170, "g", 14, 1.95, .47, 1000, [("Chile Limón", RED), ("Fuego", "#E8590C"), ("Queso", YEL)], shelf=180),
    ]),
    dict(name="Abuela Chona", origin="Mexico", sup="MX1", color="#862E9C", accent="#FFE8CC", lines=[
        L("Desserts & Dulce de Leche", "jar", "Cajeta", 660, "g", 12, 3.95, .48, 200, [("Quemada", BROWN), ("Vainilla", CREAM)], shelf=540),
        L("Desserts & Dulce de Leche", "box", "Flan Mix", 50, "g", 24, 1.05, .45, 240, [("Vainilla", CREAM), ("Cajeta", BROWN)], shelf=540),
        L("Spices & Seasonings", "pouch", "Taco Seasoning", 30, "g", 48, 0.95, .40, 600, [("Mild", ORANGE), ("Picante", RED)], shelf=540),
    ]),
    # ---------------------------------------------------------------- USA
    dict(name="Brightside", origin="United States", sup="US1", color="#F76707", accent="#1C7ED6", lines=[
        L("Breakfast Cereals", "cereal", "Cereal", 340, "g", 12, 3.60, .55, 520, [("Frosted Puffs", BLUE), ("PB Crunch", BROWN), ("Choco Loops", "#5C3D2E")], shelf=300),
    ]),
    dict(name="Smokestack", origin="United States", sup="US1", color="#212529", accent="#E8590C", lines=[
        L("BBQ & Marinades", "bottle", "BBQ Sauce", 510, "g", 12, 2.85, .52, 520, [("Original", BROWN), ("Honey Hickory", "#F08C00"), ("Carolina Gold", YEL), ("Spicy Chipotle", RED)], shelf=540),
        L("BBQ & Marinades", "jug", "BBQ Sauce Catering", 3.6, "kg", 4, 13.50, .50, 50, [("Original", BROWN)], horeca=True),
    ]),
    dict(name="Kettle & Pine", origin="United States", sup="US1", color="#2B8A3E", accent="#F8F9FA", lines=[
        L("Chips & Totopos", "bag", "Kettle Chips", 142, "g", 15, 2.30, .53, 700, [("Sea Salt & Vinegar", BLUE), ("Jalapeño", GREEN), ("Dill Pickle", "#74B816"), ("Honey BBQ", BROWN)], shelf=210),
    ]),
    dict(name="Fizzwell", origin="United States", sup="US1", color="#7048E8", accent="#FFD43B", lines=[
        L("Soft Drinks", "can", "Soda", 355, "ml", 12, 1.05, .55, 2100,
          [("Root Beer", BROWN), ("Cream Soda", CREAM), ("Grape", PURPLE), ("Orange", ORANGE), ("Cherry Cola", "#A61E4D"), ("Blue Raspberry", BLUE)], vat=21, shelf=360),
    ]),
    dict(name="VoltAge", origin="United States", sup="US1", color="#101113", accent="#94D82D", lines=[
        L("Energy Drinks", "can_tall", "Energy", 473, "ml", 12, 1.45, .56, 1800,
          [("Original", "#94D82D"), ("Zero Sugar", "#ADB5BD"), ("Tropical Punch", PINK), ("Blue Raspberry", BLUE), ("Mango Loco", "#F59F00")], vat=21, shelf=450),
    ]),
    dict(name="Sugarloaf", origin="United States", sup="US1", color="#E64980", accent="#FFF0F6", lines=[
        L("Candy", "bag", "Sour Belts", 135, "g", 12, 1.95, .52, 760, [("Rainbow", PINK), ("Blue Raspberry", BLUE), ("Green Apple", GREEN)], shelf=365),
        L("Candy", "box", "Marshmallow Twists", 200, "g", 12, 2.10, .52, 300, [("Vanilla Strawberry", PINK)], shelf=300),
        L("Chocolate", "bar", "Peanut Butter Cups", 42, "g", 36, 0.95, .54, 1500, [("Milk", BROWN), ("Dark", BLACK), ("White", CREAM)], shelf=270),
        L("Chocolate", "bar", "Caramel Pretzel Bar", 52, "g", 36, 1.10, .54, 820, [("Milk", BROWN)], shelf=270),
    ]),
    dict(name="Dixon's Pantry", origin="United States", sup="US1", color="#1864AB", accent="#FFD43B", lines=[
        L("Pancakes & Syrups", "box", "Mac & Cheese", 206, "g", 12, 1.45, .53, 640, [("Original", YEL), ("Three Cheese", ORANGE)], shelf=540),
        L("Pancakes & Syrups", "box", "Pancake Mix", 907, "g", 12, 3.20, .52, 260, [("Buttermilk", CREAM), ("Blueberry", BLUE)], shelf=360),
        L("Pancakes & Syrups", "bottle", "Pancake Syrup", 710, "ml", 12, 3.45, .52, 300, [("Original", BROWN), ("Butter", YEL)], shelf=720),
        L("Spices & Seasonings", "jar", "Peanut Butter", 454, "g", 12, 3.10, .54, 420, [("Creamy", BROWN), ("Crunchy", "#A0522D")], shelf=360),
    ]),
    # ---------------------------------------------------------------- Japan
    dict(name="Hanamaru", origin="Japan", sup="JP1", color="#C92A2A", accent="#FFF5F5", lines=[
        L("Instant Noodles", "cup", "Ramen Cup", 75, "g", 12, 1.35, .55, 1700, [("Tonkotsu", CREAM), ("Shoyu", BROWN), ("Miso", "#E67700"), ("Spicy Seafood", RED)], shelf=240),
        L("Instant Noodles", "bag", "Ramen 5-Pack", 500, "g", 6, 4.20, .55, 380, [("Shoyu", BROWN), ("Tonkotsu", CREAM)], shelf=240),
        L("Instant Noodles", "tray", "Yakisoba", 110, "g", 12, 1.65, .55, 620, [("Original", "#E8590C"), ("Teriyaki", BROWN)], shelf=240),
    ]),
    dict(name="Kaze", origin="Japan", sup="JP1", color="#212529", accent="#C92A2A", lines=[
        L("Asian Sauces", "bottle", "Soy Sauce", 500, "ml", 12, 3.20, .52, 640, [("Koikuchi", BLACK), ("Less Salt", GREEN)], shelf=720),
        L("Asian Sauces", "jug", "Soy Sauce", 1.8, "L", 6, 8.90, .50, 160, [("Koikuchi", BLACK)], shelf=720, horeca=True),
        L("Asian Sauces", "bottle", "Ponzu", 250, "ml", 12, 3.40, .52, 200, [("Yuzu", YEL)], shelf=540),
        L("Asian Sauces", "bottle", "Mirin", 500, "ml", 12, 3.60, .52, 210, [("Hon Mirin", "#E9B949")], shelf=720),
        L("Asian Sauces", "bottle", "Rice Vinegar", 500, "ml", 12, 2.70, .52, 260, [("Sushi", CREAM)], shelf=720),
        L("Asian Sauces", "bottle_slim", "Japanese Mayo", 300, "g", 20, 2.90, .53, 520, [("Original", YEL)], shelf=300),
    ]),
    dict(name="Sakura Mochi Co.", origin="Japan", sup="JP1", color="#F783AC", accent="#2B8A3E", lines=[
        L("Mochi & Asian Sweets", "box", "Mochi", 210, "g", 24, 2.60, .54, 640, [("Matcha", GREEN), ("Strawberry", PINK), ("Mango", "#F59F00"), ("Red Bean", "#862E2E")], shelf=240),
        L("Mochi & Asian Sweets", "box", "Pocky-style Sticks", 45, "g", 40, 1.25, .55, 900, [("Chocolate", BROWN), ("Strawberry", PINK), ("Matcha", GREEN)], shelf=300),
    ]),
    dict(name="Hoshi", origin="Japan", sup="JP1", color="#1C7ED6", accent="#E7F5FF", lines=[
        L("Asian Drinks", "ramune", "Ramune Marble Soda", 200, "ml", 30, 1.30, .56, 1600, [("Original", BLUE), ("Melon", "#82C91E"), ("Lychee", PINK), ("Strawberry", RED), ("Yuzu", YEL)], vat=21, shelf=360),
        L("Coffee & Tea", "can", "Matcha Latte", 240, "ml", 24, 1.35, .55, 380, [("Matcha", GREEN)], shelf=360),
    ]),
    # ---------------------------------------------------------------- Korea
    dict(name="Hangang", origin="South Korea", sup="KR1", color="#C2255C", accent="#FFD8A8", lines=[
        L("Curry & Chili Pastes", "tub", "Gochujang", 500, "g", 20, 3.40, .53, 620, [("Mild", ORANGE), ("Hot", RED)], shelf=540),
        L("Curry & Chili Pastes", "tub", "Ssamjang", 500, "g", 20, 3.30, .53, 260, [("Original", BROWN)], shelf=540),
        L("Asian Sauces", "bottle", "Korean BBQ Marinade", 480, "g", 12, 3.15, .53, 320, [("Bulgogi", BROWN), ("Galbi", "#862E2E")], shelf=540),
        L("Canned Chiles & Vegetables", "tin", "Kimchi", 160, "g", 24, 1.45, .52, 520, [("Original", RED)], shelf=720),
    ]),
    dict(name="Bukchon", origin="South Korea", sup="KR1", color="#101113", accent="#FA5252", lines=[
        L("Instant Noodles", "pouch", "Fire Noodles", 140, "g", 40, 1.55, .54, 2400, [("Hot Chicken", RED), ("Carbonara", PINK), ("Cheese", YEL), ("2x Spicy", "#A61E1E")], shelf=240),
        L("Instant Noodles", "bag", "Fire Noodles 5-Pack", 700, "g", 8, 6.90, .54, 520, [("Hot Chicken", RED), ("Carbonara", PINK)], shelf=240),
        L("Instant Noodles", "cup", "Fire Noodles Cup", 70, "g", 30, 1.45, .55, 980, [("Hot Chicken", RED)], shelf=240),
    ]),
    dict(name="Jeju Dew", origin="South Korea", sup="KR1", color="#37B24D", accent="#FFFFFF", lines=[
        L("Asian Drinks", "bottle_pet", "Aloe Drink", 500, "ml", 20, 1.40, .52, 1500, [("Original", GREEN), ("Mango", "#F59F00"), ("Grape", PURPLE), ("Peach", PINK)], vat=21, shelf=540),
        L("Asian Drinks", "carton", "Flavoured Milk", 200, "ml", 24, 1.20, .55, 1100, [("Banana", YEL), ("Strawberry", PINK), ("Melon", "#82C91E")], shelf=240),
    ]),
    dict(name="Gim Gim", origin="South Korea", sup="KR1", color="#0B7285", accent="#C3FAE8", lines=[
        L("Seaweed & Rice Snacks", "flatpack", "Seaweed Snack 3-Pack", 15, "g", 24, 1.40, .52, 820, [("Sea Salt", TEAL), ("Wasabi", GREEN), ("Kimchi", RED)], shelf=300),
        L("Seaweed & Rice Snacks", "bag", "Rice Crackers", 120, "g", 16, 1.90, .52, 380, [("Honey Butter", YEL), ("Spicy", RED)], shelf=240),
    ]),
    # ---------------------------------------------------------------- Thailand
    dict(name="Siam Garden", origin="Thailand", sup="TH1", color="#087F5B", accent="#FAB005", lines=[
        L("Coconut Milk & Cream", "tin", "Coconut Milk", 400, "ml", 24, 1.35, .48, 1500, [("17-19% Fat", CREAM), ("Light", "#E9ECEF")], shelf=720),
        L("Coconut Milk & Cream", "carton", "Coconut Cream", 1, "L", 12, 3.60, .48, 220, [("Original", CREAM)], shelf=360, horeca=True),
        L("Curry & Chili Pastes", "tub", "Curry Paste", 400, "g", 24, 2.35, .47, 520, [("Red", RED), ("Green", GREEN), ("Yellow", YEL), ("Massaman", BROWN), ("Panang", "#D9480F")], shelf=720),
        L("Asian Sauces", "bottle", "Sweet Chili Sauce", 700, "ml", 12, 2.40, .47, 640, [("Original", RED)], shelf=720),
        L("Asian Sauces", "bottle", "Fish Sauce", 700, "ml", 12, 2.60, .47, 380, [("Premium", BROWN)], shelf=900),
        L("Asian Sauces", "bottle", "Oyster Sauce", 510, "g", 12, 2.70, .47, 360, [("Original", BROWN)], shelf=720),
    ]),
    dict(name="Lotus Bay", origin="Thailand", sup="TH1", color="#5F3DC4", accent="#FFF3BF", lines=[
        L("Rice & Grains", "sack", "Jasmine Rice", 1, "kg", 10, 2.65, .50, 900, [("Hom Mali", CREAM)], vat=4, shelf=720),
        L("Rice & Grains", "sack", "Jasmine Rice", 5, "kg", 4, 11.80, .50, 260, [("Hom Mali", CREAM)], vat=4, shelf=720),
        L("Rice & Grains", "sack", "Jasmine Rice", 20, "kg", 1, 42.00, .50, 90, [("Hom Mali", CREAM)], vat=4, shelf=720, horeca=True),
        L("Rice & Grains", "sack", "Sticky Rice", 1, "kg", 10, 2.90, .50, 200, [("Glutinous", "#F8F9FA")], vat=4, shelf=720),
        L("Instant Noodles", "flatpack", "Rice Noodles", 400, "g", 24, 1.85, .48, 520, [("3 mm Pad Thai", CREAM), ("10 mm", "#E9ECEF")], shelf=720),
    ]),
    dict(name="Coco Tropic", origin="Thailand", sup="TH1", color="#2B8A3E", accent="#FFF9DB", lines=[
        L("Juices & Nectars", "can_tall", "Coconut Water", 520, "ml", 24, 1.30, .52, 1300, [("Pure", "#D3F9D8"), ("With Pulp", CREAM), ("Pineapple", YEL)], shelf=540),
    ]),
    # ---------------------------------------------------------------- Peru
    dict(name="Inca Valle", origin="Peru", sup="PE1", color="#E67700", accent="#2B2B2B", lines=[
        L("Curry & Chili Pastes", "jar", "Ají Paste", 212, "g", 24, 2.45, .48, 560, [("Amarillo", YEL), ("Panca", "#A61E1E"), ("Rocoto", RED)], shelf=540),
        L("Rice & Grains", "pouch", "Quinoa", 500, "g", 20, 3.10, .52, 300, [("White", CREAM), ("Tricolor", "#A61E1E")], vat=4, shelf=540),
        L("Chips & Totopos", "bag", "Cancha Corn", 400, "g", 20, 2.30, .48, 260, [("Chulpe", YEL)], shelf=360),
        L("Juices & Nectars", "bottle_pet", "Chicha Morada", 1, "L", 12, 2.40, .50, 300, [("Original", PURPLE)], vat=21, shelf=270),
    ]),
    dict(name="Kola Andina", origin="Peru", sup="PE1", color="#FAB005", accent="#1864AB", lines=[
        L("Soft Drinks", "bottle_pet", "Golden Soda", 500, "ml", 12, 1.25, .52, 900, [("Original", YEL), ("Zero", "#ADB5BD")], vat=21, shelf=270),
        L("Soft Drinks", "bottle_pet", "Golden Soda", 1.5, "L", 6, 2.40, .52, 320, [("Original", YEL)], vat=21, shelf=270),
    ]),
    # ---------------------------------------------------------------- Brazil
    dict(name="Raiz Tropical", origin="Brazil", sup="BR1", color="#2F9E44", accent="#FCC419", lines=[
        L("Flours & Masa", "pouch", "Pão de Queijo Mix", 500, "g", 20, 2.95, .48, 380, [("Original", YEL)], shelf=360),
        L("Flours & Masa", "pouch", "Farofa", 500, "g", 20, 2.20, .46, 280, [("Temperada", "#E9B949")], shelf=300),
        L("Soft Drinks", "can", "Guaraná", 350, "ml", 12, 0.95, .52, 1400, [("Original", GREEN), ("Zero", "#ADB5BD")], vat=21, shelf=270),
        L("Beans & Pulses", "pouch", "Feijão Preto", 1, "kg", 10, 2.60, .48, 260, [("Black Beans", BLACK)], vat=4, shelf=360),
    ]),
    dict(name="Doce Minas", origin="Brazil", sup="BR1", color="#A61E4D", accent="#FFF0F6", lines=[
        L("Desserts & Dulce de Leche", "jar", "Doce de Leite", 400, "g", 12, 3.30, .48, 280, [("Cremoso", BROWN)], shelf=360),
        L("Candy", "box", "Paçoca", 400, "g", 12, 3.10, .47, 260, [("Peanut Rolls", "#C08457")], shelf=300),
    ]),
    # ---------------------------------------------------------------- Colombia
    dict(name="Montaña Verde", origin="Colombia", sup="CO1", color="#2B8A3E", accent="#FAB005", lines=[
        L("Flours & Masa", "sack", "Arepa Flour", 1, "kg", 10, 2.15, .46, 900, [("White Corn", CREAM), ("Yellow Corn", YEL)], vat=4, shelf=360),
        L("Desserts & Dulce de Leche", "box", "Panela", 500, "g", 24, 1.80, .45, 320, [("Block", BROWN)], vat=4, shelf=540),
        L("Coffee & Tea", "pouch", "Ground Coffee", 500, "g", 12, 6.40, .55, 380, [("Tostado Medio", BROWN), ("Excelso", "#5C3D2E")], shelf=360),
    ]),
    dict(name="Colombianita", origin="Colombia", sup="CO1", color="#E03131", accent="#FFD43B", lines=[
        L("Soft Drinks", "bottle_pet", "Soda", 400, "ml", 12, 1.10, .52, 820, [("Manzana", RED), ("Uva", PURPLE), ("Kola", "#E8590C")], vat=21, shelf=270),
        L("Juices & Nectars", "glass", "Malta", 330, "ml", 24, 1.20, .52, 520, [("Original", BROWN)], vat=21, shelf=270),
    ]),
    # ---------------------------------------------------------------- India
    dict(name="Masala Ghar", origin="India", sup="IN1", color="#D9480F", accent="#FFF4E6", lines=[
        L("Spices & Seasonings", "box", "Spice Mix", 100, "g", 30, 1.70, .44, 640, [("Garam Masala", BROWN), ("Tikka Masala", RED), ("Biryani", YEL), ("Chana Masala", ORANGE)], shelf=540),
        L("Rice & Grains", "sack", "Basmati Rice", 1, "kg", 10, 3.20, .50, 520, [("Extra Long", CREAM)], vat=4, shelf=720),
        L("Rice & Grains", "sack", "Basmati Rice", 5, "kg", 4, 14.50, .50, 140, [("Extra Long", CREAM)], vat=4, shelf=720, horeca=True),
        L("Cooking Sauces & Moles", "jar", "Mango Chutney", 340, "g", 12, 2.40, .48, 260, [("Sweet", "#F59F00")], shelf=540),
        L("Seaweed & Rice Snacks", "box", "Poppadoms", 200, "g", 20, 1.95, .46, 220, [("Plain", CREAM), ("Black Pepper", BLACK)], shelf=360),
    ]),
    # ---------------------------------------------------------------- UK
    dict(name="Brambleford", origin="United Kingdom", sup="UK1", color="#364FC7", accent="#FFD43B", lines=[
        L("Biscuits & Cookies", "flatpack", "Biscuits", 300, "g", 12, 1.85, .56, 420, [("Custard Creams", YEL), ("Bourbon Creams", BROWN), ("Ginger Nuts", ORANGE)], shelf=240),
        L("Coffee & Tea", "box", "Breakfast Tea 80 Bags", 250, "g", 12, 3.40, .55, 260, [("English Breakfast", RED)], shelf=720),
    ]),
    # ---------------------------------------------------------------- Own POS
    dict(name="Puerto Sabor", origin="Spain", sup="ES1", color="#0B3D4F", accent="#F76707", lines=[
        L("Displays & POS", "box", "Floor Display Cardboard", 1, "u", 1, 18.00, .60, 15, [("World Foods", TEAL)], vat=21, shelf=3650),
        L("Displays & POS", "box", "Counter Display", 1, "u", 1, 6.50, .60, 20, [("Candy", PINK)], vat=21, shelf=3650),
    ]),
]

# Products launched inside the window (show as "New in 2026" etc.)
LAUNCHES = {
    ("Doña Lupe", "Hot Sauce", "Mango Habanero"): date(2026, 3, 2),
    ("Bukchon", "Fire Noodles", "2x Spicy"): date(2026, 5, 18),
    ("VoltAge", "Energy", "Mango Loco"): date(2026, 6, 1),
    ("Hoshi", "Ramune Marble Soda", "Yuzu"): date(2026, 4, 13),
    ("Sakura Mochi Co.", "Mochi", "Red Bean"): date(2026, 9, 7),
    ("Tostaditas Sol", "Chips", "Queso"): date(2026, 2, 9),
    ("Inca Valle", "Ají Paste", "Rocoto"): date(2025, 10, 6),
    ("Jeju Dew", "Flavoured Milk", "Melon"): date(2026, 7, 6),
    ("Kettle & Pine", "Kettle Chips", "Dill Pickle"): date(2025, 6, 2),
    ("Fizzwell", "Soda", "Blue Raspberry"): date(2025, 9, 15),
    ("Gim Gim", "Rice Crackers", "Honey Butter"): date(2026, 1, 12),
    ("Smokestack", "BBQ Sauce", "Spicy Chipotle"): date(2026, 10, 5),
    ("Picosito", "Chili Gummies", "Piña"): date(2026, 10, 19),
}
# Discontinued: still in Odoo, archived, no stock
DISCONTINUED = {("Brightside", "Cereal", "Choco Loops"), ("Brambleford", "Biscuits", "Ginger Nuts")}

ORIGIN_SHORT = {"Mexico": "Mexican", "United States": "American", "Japan": "Japanese",
                "South Korea": "Korean", "Thailand": "Thai", "Peru": "Peruvian",
                "Brazil": "Brazilian", "Colombia": "Colombian", "India": "Indian",
                "United Kingdom": "British", "Spain": "Spanish"}


def ean13(body12: str) -> str:
    s = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(body12))
    return body12 + str((10 - s % 10) % 10)


def fmt_size(size, unit):
    if unit == "u":
        return f"{int(size)} u" if size > 1 else ""
    if isinstance(size, float) and not size.is_integer():
        return f"{str(size).replace('.', ',')} {unit}"
    return f"{int(size)} {unit}"


def unit_weight_kg(size, unit, pack):
    base = {"g": size / 1000, "kg": size, "ml": size / 1000, "L": size, "u": 0.05 * size}[unit]
    tare = {"glass": .22, "jar": .18, "tin": .06, "tin_big": .25, "can": .015, "can_tall": .02,
            "bottle": .06, "bottle_slim": .04, "bottle_pet": .03, "ramune": .2, "jug": .15,
            "cup": .02, "carton": .01}.get(pack, .01)
    return base * (1.03 if unit in ("ml", "L") else 1) + tare


# --------------------------------------------------------------------------
# Build products
# --------------------------------------------------------------------------
products = []
brands_out = {}
sku = 31001
for bi, b in enumerate(BRANDS):
    brands_out[b["name"]] = dict(color=b["color"], accent=b["accent"], origin=b["origin"],
                                 supplier=SUPPLIERS[b["sup"]][0])
    for line in b["lines"]:
        for vi, (variant, vcolor) in enumerate(line["variants"]):
            size_txt = fmt_size(line["size"], line["unit"])
            name = f'{b["name"]} {line["word"]} {variant} {size_txt}'.strip()
            if variant in ("Original",) and len(line["variants"]) == 1:
                name = f'{b["name"]} {line["word"]} {size_txt}'.strip()
            launched = LAUNCHES.get((b["name"], line["word"], variant))
            if launched is None:
                launched = START - timedelta(days=rng.randint(200, 2400))
            upc = line["upc"]
            uw = unit_weight_kg(line["size"], line["unit"], line["pack"])
            case_kg = round(uw * upc + 0.25, 2)
            cpp = max(20, min(160, int(600 / max(case_kg, 1.5))))
            cpp = int(round(cpp / 5) * 5) if cpp > 20 else cpp
            price = round(line["price"] * rng.uniform(0.97, 1.03), 2)
            cost = round(price * line["cost"] * 1.24 * rng.uniform(0.95, 1.05), 3)  # landed cost: FOB + freight + duty
            # variants after the first sell a bit less
            vel = line["vel"] / len(line["variants"]) * (1.25 if vi == 0 else rng.uniform(0.55, 1.05))
            p = dict(
                id=len(products) + 1,
                sku=str(sku),
                name=name,
                brand=b["name"],
                origin=b["origin"],
                cuisine=ORIGIN_SHORT[b["origin"]],
                category=CATEGORY_OF[line["sub"]],
                subcategory=line["sub"],
                variant=variant,
                word=line["word"],
                size=size_txt,
                pack=line["pack"],
                color=vcolor,
                units_per_case=upc,
                cases_per_pallet=cpp,
                case_weight_kg=case_kg,
                ean=ean13(f"20{bi:02d}{sku % 100000:05d}{vi:03d}"[:12]),
                ean_case=ean13(f"21{bi:02d}{sku % 100000:05d}{vi:03d}"[:12]),
                list_price=price,
                cost=cost,
                vat=line.get("vat", 10),
                shelf_life_days=line.get("shelf", 365),
                storage="Ambient",
                horeca=bool(line.get("horeca")),
                launched=launched.isoformat(),
                active=(b["name"], line["word"], variant) not in DISCONTINUED,
                supplier=b["sup"],
                _vel=vel,
            )
            products.append(p)
            sku += 1
    sku = (sku // 50 + 1) * 50 + 1   # leave gaps between brands, like a real numbering scheme

P_BY_ID = {p["id"]: p for p in products}
print(f"{len(products)} products")

# --------------------------------------------------------------------------
# Sales team, price lists
# --------------------------------------------------------------------------
REPS = [
    dict(id=1, name="Marta Gil", area="Madrid & Centre", email="marta.gil@puertosabor.example"),
    dict(id=2, name="Javier Ortega", area="Catalonia & Levante", email="javier.ortega@puertosabor.example"),
    dict(id=3, name="Lucía Romero", area="Andalusia, North & Portugal", email="lucia.romero@puertosabor.example"),
    dict(id=4, name="Tomás Weber", area="Export (DE · FR · Benelux)", email="tomas.weber@puertosabor.example"),
]

ASIAN = {"Japan", "South Korea", "Thailand", "India"}
LATIN = {"Mexico", "Peru", "Brazil", "Colombia"}


def pl_items(pred, factor, keep=1.0):
    out = []
    for p in products:
        if not p["active"] and rng.random() < .6:
            continue
        if pred(p) and rng.random() < keep:
            out.append([p["id"], round(p["list_price"] * factor * rng.uniform(.99, 1.01), 2)])
    return out


PRICELISTS = [
    dict(id=1, name="Wholesale Spain 2026", code="WHS-ES", note="Base list for independent shops. Delivered, orders over €250.",
         items=pl_items(lambda p: p["category"] != "Non-food" or True, 1.00)),
    dict(id=2, name="Asian Specialty 2026", code="ASIA", note="Asian supermarkets and shops.",
         items=pl_items(lambda p: p["origin"] in ASIAN or p["subcategory"] in ("Soft Drinks", "Energy Drinks", "Chocolate"), .98)),
    dict(id=3, name="Latin Specialty 2026", code="LATAM", note="Latin American shops (Mexican, Peruvian, Colombian, Brazilian).",
         items=pl_items(lambda p: p["origin"] in LATIN or p["subcategory"] in ("Energy Drinks",), .98)),
    dict(id=4, name="American Candy & Soda 2026", code="USA", note="Candy stores, kiosks, souvenir shops.",
         items=pl_items(lambda p: p["origin"] == "United States" or p["subcategory"] in ("Candy", "Asian Drinks", "Mochi & Asian Sweets", "Chips & Totopos") or p["category"] == "Non-food", 1.00)),
    dict(id=5, name="HoReCa 2026", code="HORECA", note="Restaurants and caterers. Catering formats, weekly delivery.",
         items=pl_items(lambda p: p["horeca"] or p["subcategory"] in ("Hot Sauces", "Tortillas & Tostadas", "Canned Chiles & Vegetables", "Asian Sauces", "Coconut Milk & Cream", "Curry & Chili Pastes", "Soft Drinks", "Asian Drinks", "Flours & Masa", "Rice & Grains"), 1.04)),
    dict(id=6, name="Retail Chains 2026", code="CHAIN", note="Supermarket chains. Net-net prices, listing agreements, 60-day terms.",
         items=pl_items(lambda p: p["_vel"] > 160 and p["category"] != "Non-food", .91)),
    dict(id=7, name="Export EU 2026 · EXW Getafe", code="EXPORT", note="Ex-works Getafe. Full pallets preferred, min. 10 cases.",
         items=pl_items(lambda p: p["category"] != "Non-food" and p["_vel"] > 140, .93, keep=.8)),
    dict(id=8, name="Portugal 2026", code="PT", note="Delivered Lisbon & Porto, weekly truck.",
         items=pl_items(lambda p: (p["origin"] in LATIN | ASIAN | {"United States"}) and p["_vel"] > 230, .97)),
    dict(id=9, name="Cash & Carry 2026", code="C&C", note="Cash & carry wholesalers. Full layers.",
         items=pl_items(lambda p: p["category"] != "Non-food", .94, keep=.75)),
]
PL_BY_ID = {pl["id"]: pl for pl in PRICELISTS}
for pl in PRICELISTS:
    pl["price_of"] = {pid: price for pid, price in pl["items"]}

# --------------------------------------------------------------------------
# Customers
# --------------------------------------------------------------------------
# kind -> (pricelist, interval days, size factor range, origin affinity, basket size range, terms)
KINDS = {
    "Supermarket chain": (6, 8, (6.0, 10.0), None, (55, 95), "60 days"),
    "Cash & carry": (9, 14, (3.5, 6.5), None, (60, 110), "30 days"),
    "Asian supermarket": (2, 11, (1.3, 2.6), ASIAN, (35, 65), "30 days"),
    "Latin shop": (3, 16, (0.6, 1.3), LATIN, (18, 40), "Immediate payment"),
    "Asian shop": (2, 17, (0.6, 1.2), ASIAN, (16, 34), "Immediate payment"),
    "Candy & soda store": (4, 13, (0.7, 1.6), {"United States", "Japan", "South Korea"}, (20, 42), "15 days"),
    "Independent grocery": (1, 20, (0.4, 0.9), None, (10, 26), "30 days"),
    "Restaurant": (5, 9, (0.35, 0.9), None, (7, 18), "30 days"),
    "Online shop": (1, 12, (0.8, 1.8), None, (30, 70), "15 days"),
    "Export distributor": (7, 24, (3.0, 6.0), None, (40, 80), "Prepayment"),
    "Portugal shop": (8, 15, (0.7, 1.4), None, (20, 40), "30 days"),
}

CUSTOMERS_SPEC = [
    # name, kind, city, region/country, rep, stores (delivery addresses), since, churn
    ("Supermercados Hermanos Valdés", "Supermarket chain", "Madrid", "ES", 1,
     ["Valdés Chamberí", "Valdés Arganzuela", "Valdés Tetuán", "Valdés Alcobendas", "Valdés Getafe", "Valdés Leganés", "Valdés Pozuelo", "Valdés Alcalá de Henares", "Valdés Majadahonda"], "2019-03-11", None),
    ("Frescoval Supermercados", "Supermarket chain", "Valencia", "ES", 2,
     ["Frescoval Russafa", "Frescoval Benimaclet", "Frescoval Campanar", "Frescoval Paterna", "Frescoval Torrent", "Frescoval Gandia"], "2021-09-20", None),
    ("SuperSur Andalucía", "Supermarket chain", "Sevilla", "ES", 3,
     ["SuperSur Triana", "SuperSur Nervión", "SuperSur Dos Hermanas", "SuperSur Jerez", "SuperSur Córdoba Centro", "SuperSur Huelva", "SuperSur Cádiz"], "2022-02-14", None),
    ("Ultramarinos Ibarra", "Supermarket chain", "Bilbao", "ES", 3,
     ["Ibarra Indautxu", "Ibarra Deusto", "Ibarra Getxo", "Ibarra Barakaldo"], "2023-05-08", None),
    ("Mercaclub Levante", "Cash & carry", "Valencia", "ES", 2, ["Mercaclub Riba-roja", "Mercaclub Alicante"], "2020-11-02", None),
    ("Distribuciones Comercial Rius", "Cash & carry", "Barcelona", "ES", 2, ["Rius Mercabarna", "Rius Sabadell"], "2021-04-19", None),
    ("Mayoristas del Sur Málaga", "Cash & carry", "Málaga", "ES", 3, ["Polígono Guadalhorce"], "2025-02-03", None),
    ("Mercado Oriental Hnos. Chen", "Asian supermarket", "Madrid", "ES", 1, ["Chen Usera", "Chen Plaza de España", "Chen Fuenlabrada"], "2020-06-15", None),
    ("Kim's Mart Barcelona", "Asian supermarket", "Barcelona", "ES", 2, ["Kim's Mart Eixample", "Kim's Mart Gràcia"], "2022-10-03", None),
    ("Oriental Market Valencia", "Asian supermarket", "Valencia", "ES", 2, ["Av. Pérez Galdós"], "2021-01-25", None),
    ("Bangkok Bazar Málaga", "Asian supermarket", "Málaga", "ES", 3, ["Calle Cuarteles"], "2023-03-13", None),
    ("Tienda La Lupita", "Latin shop", "Madrid", "ES", 1, ["Lavapiés"], "2019-09-02", None),
    ("Mi Tierra Latina", "Latin shop", "Barcelona", "ES", 2, ["Raval"], "2020-02-17", None),
    ("El Rincón Peruano", "Latin shop", "Madrid", "ES", 1, ["Usera"], "2021-07-05", None),
    ("Sabor Colombiano Alimentación", "Latin shop", "Madrid", "ES", 1, ["Tetuán"], "2022-04-11", None),
    ("Mercadito Mexicano Valencia", "Latin shop", "Valencia", "ES", 2, ["Ruzafa"], "2023-01-16", None),
    ("La Tiendita de Frida", "Latin shop", "Sevilla", "ES", 3, ["Alameda"], "2022-11-21", None),
    ("Casa Brasil Mercearia", "Latin shop", "Madrid", "ES", 1, ["Malasaña"], "2024-02-05", "2026-05-20"),
    ("Productos Andinos Zaragoza", "Latin shop", "Zaragoza", "ES", 2, ["Delicias"], "2023-09-04", None),
    ("Mexicanísimo Bilbao", "Latin shop", "Bilbao", "ES", 3, ["Casco Viejo"], "2026-06-01", None),
    ("Asia Market Usera", "Asian shop", "Madrid", "ES", 1, ["Usera"], "2020-10-12", None),
    ("Tokyo Shop Valencia", "Asian shop", "Valencia", "ES", 2, ["Ciutat Vella"], "2021-06-07", None),
    ("Seúl Market", "Asian shop", "Barcelona", "ES", 2, ["Sant Antoni"], "2023-02-20", None),
    ("Masala Bazar Lavapiés", "Asian shop", "Madrid", "ES", 1, ["Lavapiés"], "2022-01-17", None),
    ("Bollywood Foods", "Asian shop", "Barcelona", "ES", 2, ["Raval"], "2023-06-12", "2025-12-15"),
    ("K-Mart Granada", "Asian shop", "Granada", "ES", 3, ["Centro"], "2024-10-14", None),
    ("Otaku Snacks Madrid", "Asian shop", "Madrid", "ES", 1, ["Callao"], "2025-09-08", None),
    ("Candy Corner Gran Vía", "Candy & soda store", "Madrid", "ES", 1, ["Gran Vía", "Fuencarral"], "2020-04-20", None),
    ("Yankee Sweets", "Candy & soda store", "Barcelona", "ES", 2, ["Portal de l'Àngel", "La Maquinista"], "2021-03-01", None),
    ("American Store Marbella", "Candy & soda store", "Marbella", "ES", 3, ["Puerto Banús"], "2022-05-30", None),
    ("Sweet Rush", "Candy & soda store", "Zaragoza", "ES", 2, ["Puerta Cinegia"], "2023-10-23", None),
    ("Dulcería Sugar Planet", "Candy & soda store", "Palma", "ES", 2, ["Jaume III"], "2024-03-04", None),
    ("Snack Attack Benidorm", "Candy & soda store", "Benidorm", "ES", 2, ["Levante"], "2026-04-20", None),
    ("Alimentación Moreno", "Independent grocery", "Murcia", "ES", 2, ["Centro"], "2019-11-04", None),
    ("Supermercado La Esquina", "Independent grocery", "Granada", "ES", 3, ["Realejo"], "2021-02-08", None),
    ("Ultramarinos Pazos", "Independent grocery", "A Coruña", "ES", 3, ["Ensanche"], "2022-06-20", None),
    ("Alimentación Hermanos Ruiz", "Independent grocery", "Valladolid", "ES", 1, ["Centro"], "2020-08-31", None),
    ("Gourmet Mallorca", "Independent grocery", "Palma", "ES", 2, ["Santa Catalina"], "2021-10-11", None),
    ("Delicatessen Can Pujol", "Independent grocery", "Girona", "ES", 2, ["Barri Vell"], "2023-04-24", None),
    ("Colmado Santa Ana", "Independent grocery", "Madrid", "ES", 1, ["Huertas"], "2024-01-22", None),
    ("Despensa del Mundo Toledo", "Independent grocery", "Toledo", "ES", 1, ["Casco Histórico"], "2022-09-12", "2025-07-01"),
    ("Taquería El Güero", "Restaurant", "Madrid", "ES", 1, ["El Güero Malasaña", "El Güero Chamberí", "El Güero Retiro"], "2019-05-27", None),
    ("Grupo Tacos & Co.", "Restaurant", "Madrid", "ES", 1, ["Central kitchen Alcobendas"], "2021-08-30", None),
    ("La Cantina de Coyoacán", "Restaurant", "Barcelona", "ES", 2, ["Gràcia"], "2020-03-09", None),
    ("Ramen Hinode", "Restaurant", "Valencia", "ES", 2, ["Ruzafa", "El Carmen"], "2022-03-28", None),
    ("Cevichería Lima 1535", "Restaurant", "Madrid", "ES", 1, ["Chamberí"], "2021-11-15", None),
    ("Thai Lotus", "Restaurant", "Bilbao", "ES", 3, ["Abando"], "2023-07-10", None),
    ("Smokey's BBQ Joint", "Restaurant", "Málaga", "ES", 3, ["Soho"], "2024-06-03", None),
    ("Seoul Bites", "Restaurant", "Barcelona", "ES", 2, ["Poblenou"], "2025-01-20", None),
    ("Arepera La Caraqueña", "Restaurant", "Madrid", "ES", 1, ["Tetuán"], "2023-02-06", None),
    ("Bao & Bowl Catering", "Restaurant", "Madrid", "ES", 1, ["Central kitchen Getafe"], "2026-02-16", None),
    ("Exoticbox.es", "Online shop", "Madrid", "ES", 1, ["Fulfilment Coslada"], "2021-05-10", None),
    ("SnackWorld Online", "Online shop", "Barcelona", "ES", 2, ["Warehouse El Prat"], "2022-08-22", None),
    ("Despensa Global", "Online shop", "Sevilla", "ES", 3, ["Warehouse La Rinconada"], "2024-04-29", None),
    ("Weltküche Feinkost GmbH", "Export distributor", "Hamburg", "DE", 4, ["Lager Hamburg-Billbrook"], "2021-06-28", None),
    ("Asia Markt Lindenau", "Export distributor", "Leipzig", "DE", 4, ["Lindenau"], "2023-09-18", None),
    ("Candy Planet Berlin GmbH", "Export distributor", "Berlin", "DE", 4, ["Lager Berlin-Spandau"], "2024-05-13", None),
    ("Épicerie du Monde SARL", "Export distributor", "Lyon", "FR", 4, ["Entrepôt Vénissieux"], "2022-02-21", None),
    ("Saveurs d'Asie SAS", "Export distributor", "Paris", "FR", 4, ["Entrepôt Rungis"], "2023-11-06", None),
    ("Mexi Market BV", "Export distributor", "Amsterdam", "NL", 4, ["Magazijn Amsterdam-West"], "2022-07-11", None),
    ("Latino Express BV", "Export distributor", "Antwerp", "BE", 4, ["Magazijn Antwerpen"], "2024-09-23", None),
    ("Mercearia Atlântico", "Portugal shop", "Lisboa", "PT", 3, ["Arroios"], "2022-03-07", None),
    ("Sabores do Mundo Porto", "Portugal shop", "Porto", "PT", 3, ["Bonfim"], "2023-05-22", None),
    ("Asia Mercado Martim Moniz", "Portugal shop", "Lisboa", "PT", 3, ["Martim Moniz"], "2024-01-08", None),
    ("Doces da América", "Portugal shop", "Lisboa", "PT", 3, ["Chiado"], "2026-03-09", None),
]

# fill up with more small independent / specialty accounts so the long tail is realistic
TOWNS = [("Alcalá de Henares", 1), ("Móstoles", 1), ("Fuenlabrada", 1), ("Leganés", 1), ("Guadalajara", 1),
         ("Salamanca", 1), ("Segovia", 1), ("Castellón", 2), ("Tarragona", 2), ("Lleida", 2), ("Reus", 2),
         ("Elche", 2), ("Cartagena", 2), ("Ibiza", 2), ("Almería", 3), ("Jaén", 3), ("Cádiz", 3),
         ("Huelva", 3), ("Santander", 3), ("Oviedo", 3), ("Gijón", 3), ("Vigo", 3), ("Pamplona", 3),
         ("Logroño", 3), ("San Sebastián", 3)]
SHOP_NAMES = ["Alimentación {s}", "Supermercado {s}", "Ultramarinos {s}", "Tienda Latina {s}", "Asia Food {s}",
              "Sweet Shop {s}", "Mercado Global {s}", "Colmado {s}", "Bazar Oriental {s}", "Delikatessen {s}"]
SURN = ["García", "Navarro", "Iglesias", "Castro", "Ortiz", "Rubio", "Molina", "Delgado", "Vidal", "Santos",
        "Lozano", "Marín", "Herrera", "Cano", "Prieto", "Pastor", "Soler", "Gallego", "Vega", "Ferrer",
        "Wang", "Li", "Park", "Nguyen", "Mendoza", "Quispe", "Rojas", "Gómez", "Silva", "Ramírez"]
for i in range(26):
    town, rep = TOWNS[i % len(TOWNS)]
    tmpl = rng.choice(SHOP_NAMES)
    s = rng.choice(SURN)
    nm = tmpl.format(s=s) if "{s}" in tmpl and rng.random() < .55 else tmpl.format(s=town)
    kind = ("Latin shop" if "Latina" in tmpl else "Asian shop" if ("Asia" in tmpl or "Oriental" in tmpl)
            else "Candy & soda store" if "Sweet" in tmpl else "Independent grocery")
    since = date(2019, 1, 1) + timedelta(days=rng.randint(0, 2450))
    churn = None
    if rng.random() < .12:
        churn = (max(since, START) + timedelta(days=rng.randint(120, 600))).isoformat()
    CUSTOMERS_SPEC.append((nm, kind, town, "ES", rep, ["Tienda"], since.isoformat(), churn))

STREETS = ["Calle Mayor", "Av. de la Constitución", "Calle Real", "Calle del Carmen", "Paseo de la Estación",
           "Calle San Antonio", "Calle Nueva", "Av. de América", "Calle Toledo", "Calle Alcalá", "Calle Atocha"]

customers = []
for ci, (name, kind, city, country, rep, stores, since, churn) in enumerate(CUSTOMERS_SPEC):
    pl, interval, sizer, affinity, basket_rng, terms = KINDS[kind]
    if name in ("Supermercados Hermanos Valdés",):
        pl_id = 6
    else:
        pl_id = pl
    cust = dict(
        id=ci + 1,
        ref=f"C{1040 + ci * 7:05d}",
        name=name,
        kind=kind,
        city=city,
        country=country,
        rep_id=rep,
        pricelist_id=pl_id,
        payment_terms=terms,
        since=since,
        credit_limit=int(round(sizer[1] * 6000 / 500) * 500),
        vat_number=(f"ES{rng.choice('ABN')}{rng.randint(10000000, 99999999)}" if country == "ES"
                    else f"{country}{rng.randint(100000000, 999999999)}"),
        phone=(f"+34 {rng.choice(['91', '93', '96', '95', '94', '6'])}{rng.randint(1000000, 9999999)}" if country == "ES"
               else {"PT": "+351 21", "DE": "+49 40", "FR": "+33 1", "NL": "+31 20", "BE": "+32 3"}[country] + f" {rng.randint(100000, 999999)}"),
        delivery=[dict(id=k + 1, name=s, city=(city if k == 0 or len(stores) < 3 else city),
                       street=f"{rng.choice(STREETS)}, {rng.randint(2, 180)}") for k, s in enumerate(stores)],
        churned=churn,
    )
    # chains: delivery cities derived from store names for realism
    if kind == "Supermarket chain":
        for d in cust["delivery"]:
            for town in ("Alcobendas", "Getafe", "Leganés", "Pozuelo", "Alcalá de Henares", "Majadahonda",
                         "Paterna", "Torrent", "Gandia", "Dos Hermanas", "Jerez", "Córdoba", "Huelva", "Cádiz",
                         "Getxo", "Barakaldo"):
                if town in d["name"]:
                    d["city"] = town
    cust["_interval"] = interval
    cust["_size"] = rng.uniform(*sizer)
    cust["_affinity"] = affinity
    cust["_basket"] = rng.randint(*basket_rng)
    customers.append(cust)

print(f"{len(customers)} customers")

# --------------------------------------------------------------------------
# Baskets: the customer's regular products, built from their price list,
# weighted by popularity and origin affinity. Complementary products travel
# together (tortillas with salsas, curry paste with coconut milk) so that the
# "bought together" recommendations have a real signal to find.
# --------------------------------------------------------------------------
COMPLEMENTS = [
    ({"Tortillas & Tostadas"}, {"Hot Sauces", "Canned Chiles & Vegetables", "Beans & Pulses", "Spices & Seasonings", "Cooking Sauces & Moles"}),
    ({"Curry & Chili Pastes"}, {"Coconut Milk & Cream", "Rice & Grains", "Asian Sauces"}),
    ({"Instant Noodles"}, {"Asian Drinks", "Seaweed & Rice Snacks", "Mochi & Asian Sweets"}),
    ({"Candy"}, {"Soft Drinks", "Energy Drinks", "Chocolate", "Chips & Totopos"}),
    ({"Flours & Masa"}, {"Desserts & Dulce de Leche", "Juices & Nectars", "Coffee & Tea"}),
    ({"Pancakes & Syrups"}, {"Breakfast Cereals", "Chocolate"}),
]


def affinity_weight(c, p):
    w = p["_vel"] ** 0.85
    aff = c["_affinity"]
    if aff:
        w *= 4.0 if p["origin"] in aff else 0.25
    k = c["kind"]
    if k == "Restaurant":
        w *= 5.0 if p["horeca"] else (0.9 if p["category"] in ("Sauces & Condiments", "Pantry", "Beverages") else 0.05)
        name = c["name"]
        if any(x in name for x in ("Ramen", "Thai", "Seoul", "Bao")):
            w *= 4.0 if p["origin"] in ASIAN else 0.15
        elif "BBQ" in name:
            w *= 4.0 if p["origin"] == "United States" else 0.2
        elif "Cevich" in name:
            w *= 5.0 if p["origin"] == "Peru" else 0.3
        elif "Arepera" in name:
            w *= 5.0 if p["origin"] in ("Colombia",) or p["word"] == "Malta" else 0.3
        else:
            w *= 3.5 if p["origin"] == "Mexico" else 0.2
    if k == "Candy & soda store":
        w *= 3.0 if p["category"] in ("Confectionery", "Beverages", "Snacks") else 0.15
    if k == "Asian supermarket" and p["origin"] in ASIAN:
        w *= 1.4
    if p["category"] == "Non-food":
        w *= 6.0
    return w


def build_basket(c, pool, n):
    weights = {pid: affinity_weight(c, P_BY_ID[pid]) for pid in pool}
    chosen = []
    pool = list(pool)
    for _ in range(min(n, len(pool))):
        tot = sum(weights[pid] for pid in pool if pid not in chosen)
        r = rng.random() * tot
        acc = 0
        for pid in pool:
            if pid in chosen:
                continue
            acc += weights[pid]
            if acc >= r:
                chosen.append(pid)
                # boost complements of what was just chosen
                sub = P_BY_ID[pid]["subcategory"]
                for a, bset in COMPLEMENTS:
                    if sub in a:
                        for q in pool:
                            if P_BY_ID[q]["subcategory"] in bset:
                                weights[q] *= 1.6
                    if sub in bset:
                        for q in pool:
                            if P_BY_ID[q]["subcategory"] in a:
                                weights[q] *= 1.3
                break
    return chosen


# --------------------------------------------------------------------------
# Orders
# --------------------------------------------------------------------------
def season(p, d):
    return SEASON[p["category"]][d.month - 1]


def august_factor(c, d):
    if d.month == 8 and c["country"] == "ES":
        return 0.55 if c["kind"] == "Restaurant" else 0.82
    return 1.0


def price_for(c, p, d):
    pl = PL_BY_ID[c["pricelist_id"]]
    base = pl["price_of"].get(p["id"], p["list_price"])
    # list prices went up 3.5% on 1 Jan 2026 (the 2025 lists were lower)
    if d < date(2026, 1, 1):
        base = base / 1.035
    return round(base, 2)


orders = []        # [name, customer_id, date, state, delivery_idx, delivered]
lines = []         # [order_index, product_id, qty, price_unit, discount]
so_counter = 7814  # Odoo S0xxxx numbering carries on from before the window

# accounts that have quietly stopped ordering recently (not churned in Odoo, nobody noticed yet)
PAUSED = {"Kim's Mart Barcelona": date(2026, 9, 22), "Taquería El Güero": date(2026, 10, 2)}

growth_per_day = math.log(1.05) / 365     # ~5% underlying growth (new customers add the rest)

for c in customers:
    since = date.fromisoformat(c["since"])
    first = max(START, since) + timedelta(days=rng.randint(0, c["_interval"]))
    churn = date.fromisoformat(c["churned"]) if c["churned"] else None
    pl_pool = [pid for pid, _ in PL_BY_ID[c["pricelist_id"]]["items"]
               if date.fromisoformat(P_BY_ID[pid]["launched"]) <= max(first, START)]
    basket = build_basket(c, pl_pool, c["_basket"])
    inc_p = {pid: rng.uniform(0.35, 0.9) for pid in basket}
    c["_events"] = []
    d = first
    pause = PAUSED.get(c["name"])
    while d <= TODAY and (churn is None or d < churn) and (pause is None or d < pause):
        # basket drift: try launches, drop a product now and then
        for pid in [x for x, _ in PL_BY_ID[c["pricelist_id"]]["items"]]:
            p = P_BY_ID[pid]
            ld = date.fromisoformat(p["launched"])
            if ld > START and ld <= d < ld + timedelta(days=c["_interval"] + 1) and pid not in basket:
                if rng.random() < .45 * min(2.0, affinity_weight(c, p) / max(1, p["_vel"] ** .85)):
                    basket.append(pid)
                    inc_p[pid] = rng.uniform(.4, .85)
        if rng.random() < .02 and len(basket) > 8:
            drop = rng.choice(basket)
            basket.remove(drop)
        # discontinued products: nobody can order them after mid-2025
        if d >= date(2025, 7, 1):
            basket = [pid for pid in basket if P_BY_ID[pid]["active"]]

        t = (d - START).days
        trend = math.exp(growth_per_day * t)
        oi = len(orders)
        n_lines = 0
        for pid in basket:
            p = P_BY_ID[pid]
            if rng.random() > inc_p[pid]:
                continue
            exp_cases = (c["_size"] * season(p, d) * august_factor(c, d) * trend
                         * (p["_vel"] / 400) ** 0.55 * (c["_interval"] / 14))
            cases = max(1, int(rng.gauss(exp_cases, exp_cases * .35) + .5))
            if c["kind"] == "Export distributor":
                cases = max(cases, 3)
            qty = cases * p["units_per_case"]
            disc = 0.0
            if rng.random() < .04:
                disc = rng.choice([5.0, 8.0, 10.0])   # promo / short-dated clearance
            lines.append([oi, pid, qty, price_for(c, p, d), disc])
            n_lines += 1
        # occasional one-off trial of something outside the basket
        if rng.random() < .18:
            pool = [pid for pid in pl_pool if pid not in basket]
            if pool:
                pid = rng.choice(pool)
                p = P_BY_ID[pid]
                lines.append([oi, pid, p["units_per_case"], price_for(c, p, d), 0.0])
                n_lines += 1
        if n_lines:
            dl_days = (rng.randint(5, 9) if c["country"] not in ("ES", "PT") else rng.randint(1, 3))
            delivered = d + timedelta(days=dl_days)
            state = "done" if delivered <= TODAY else "sale"
            if state == "sale" and rng.random() < .25:
                state = "sale"
            di = rng.randrange(len(c["delivery"]))
            orders.append([None, c["id"], d, state, di, delivered if state == "done" else None])
        gap = c["_interval"] * rng.uniform(.65, 1.4)
        if d.month == 12 and d.day > 20:
            gap += 4
        d = d + timedelta(days=max(2, int(round(gap))))

# Odoo names orders by creation sequence, so number them by date
order_index = sorted(range(len(orders)), key=lambda i: (orders[i][2], orders[i][1]))
for rank, i in enumerate(order_index):
    orders[i][0] = f"S{so_counter + rank:05d}"

print(f"{len(orders)} orders, {len(lines)} order lines")

# --------------------------------------------------------------------------
# Stock, lots, purchase orders
# --------------------------------------------------------------------------
last90 = defaultdict(int)
reserved = defaultdict(int)
for oi, pid, qty, price, disc in lines:
    o = orders[oi]
    if (TODAY - o[2]).days <= 90:
        last90[pid] += qty
    if o[3] == "sale":
        reserved[pid] += qty

stock = {}
po_lines = defaultdict(list)  # supplier -> [(pid, qty)]
for p in products:
    vel_m = last90[p["id"]] / 3 or p["_vel"] * .3
    if not p["active"]:
        on_hand = 0
    else:
        r = rng.random()
        if r < .08:
            cover = 0.0                       # out of stock
        elif r < .18:
            cover = rng.uniform(.08, .45)     # running low
        elif r < .26:
            cover = rng.uniform(5.0, 9.0)     # overstocked / slow
        else:
            cover = rng.uniform(.7, 3.6)
        on_hand = int(vel_m * cover / p["units_per_case"]) * p["units_per_case"]
        if date.fromisoformat(p["launched"]) > TODAY - timedelta(days=40):
            on_hand = int(vel_m * 2.5 / p["units_per_case"] + 20) * p["units_per_case"]
        if cover == 0.0:
            on_hand = min(on_hand, reserved[p["id"]])  # what is physically left is already promised
    # lots: FEFO, best-before dates spread over the shelf life
    lots = []
    remaining = on_hand
    n_lots = 1 if on_hand < 5 * p["units_per_case"] else rng.choice([1, 2, 2, 3])
    for li in range(n_lots):
        q = remaining if li == n_lots - 1 else int(remaining * rng.uniform(.25, .6) / p["units_per_case"]) * p["units_per_case"]
        remaining -= q
        if q <= 0:
            continue
        life = p["shelf_life_days"]
        bbd = TODAY + timedelta(days=int(life * rng.uniform(.35, .95)))
        if li == 0 and rng.random() < .07 and life < 1000:
            bbd = TODAY + timedelta(days=rng.randint(12, 58))   # short-dated lot to push
        lots.append([f"L{(TODAY - timedelta(days=rng.randint(10, 300))).strftime('%y%m')}-{rng.randint(100, 999)}",
                     q, bbd.isoformat()])
    stock[p["id"]] = dict(on_hand=on_hand, reserved=min(reserved[p["id"]], on_hand), lots=lots)
    # reorder: anything under ~1.6 months of cover goes on the next container
    if p["active"] and on_hand - reserved[p["id"]] < vel_m * 1.6:
        qty = max(p["units_per_case"] * 5,
                  int(vel_m * rng.uniform(2.5, 4.0) / p["units_per_case"]) * p["units_per_case"])
        po_lines[p["supplier"]].append((p["id"], qty))

PO_PLAN = {
    "MX1": [("2026-11-17", "Container MSKU 774120-3 · Veracruz → Valencia", "purchase")],
    "MX2": [("2026-11-24", "Container CMAU 518806-1 · Veracruz → Valencia", "purchase")],
    "US1": [("2026-11-28", "Groupage via Rotterdam", "purchase")],
    "JP1": [("2026-12-15", "Container ONEU 207731-0 · Kobe → Valencia", "purchase")],
    "KR1": [("2026-12-03", "Container HDMU 663412-8 · Busan → Valencia", "purchase")],
    "TH1": [("2026-12-09", "Container EGLV 920174-5 · Laem Chabang → Barcelona", "purchase")],
    "PE1": [("2026-11-21", "LCL · Callao → Valencia", "purchase")],
    "BR1": [(None, "RFQ sent, waiting for supplier's proforma", "draft")],
    "CO1": [("2026-12-01", "LCL · Cartagena → Valencia", "purchase")],
    "IN1": [("2027-01-12", "Container MSCU 334571-2 · Nhava Sheva → Valencia", "purchase")],
    "UK1": [("2026-11-10", "Truck · Dover → Getafe", "purchase")],
    "ES1": [("2026-11-07", "Local delivery", "purchase")],
}
purchases = []
po_no = 412
for sup, plines in sorted(po_lines.items()):
    for eta, note, state in PO_PLAN[sup]:
        name_sup, country, mode, transit = SUPPLIERS[sup]
        # a couple of products on each container are "no date yet": supplier out of stock
        lines_out = []
        for pid, qty in plines:
            lines_out.append([pid, qty])
        ordered = (date.fromisoformat(eta) - timedelta(days=transit + rng.randint(14, 30))) if eta else TODAY - timedelta(days=6)
        purchases.append(dict(name=f"P{po_no:05d}", supplier=name_sup, supplier_country=country,
                              date_order=ordered.isoformat(), eta=eta, state=state, note=note,
                              lines=lines_out))
        po_no += 1

# a few out-of-stock items with nothing on order at all ("No date set")
print(f"{len(purchases)} purchase orders, {sum(len(p['lines']) for p in purchases)} PO lines")

# --------------------------------------------------------------------------
# Write
# --------------------------------------------------------------------------
for p in products:
    p.pop("_vel", None)
for c in customers:
    for k in [k for k in c if k.startswith("_")]:
        c.pop(k)
for pl in PRICELISTS:
    pl.pop("price_of", None)

data = dict(
    meta=dict(
        generated_at=f"{TODAY.isoformat()}T07:00:00+01:00",
        today=TODAY.isoformat(),
        source="Simulated Odoo 17 database (demo data, nothing real)",
        currency="EUR",
    ),
    company=dict(
        name="Puerto Sabor Foods S.L.",
        short="Puerto Sabor",
        tagline="World foods, delivered across Iberia & Europe",
        address="Polígono Industrial Los Olivos, Calle Laboriosidad 14, 28906 Getafe (Madrid)",
        vat="ESB00000000",
        email="pedidos@puertosabor.example",
        phone="+34 910 000 000",
        web="puertosabor.example",
        founded=2014,
    ),
    reps=REPS,
    brands=brands_out,
    suppliers={k: dict(name=v[0], country=v[1], mode=v[2], transit_days=v[3]) for k, v in SUPPLIERS.items()},
    products=products,
    pricelists=PRICELISTS,
    customers=customers,
    orders=[[o[0], o[1], o[2].isoformat(), o[3], o[4], o[5].isoformat() if o[5] else None] for o in orders],
    lines=lines,
    stock=stock,
    purchases=purchases,
)

OUT.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
OUT.write_text("/* Generated by tools/generate_demo_data.py — fictional data. */\nwindow.DEMO=" + payload + ";\n",
               encoding="utf-8")
print(f"wrote {OUT} ({len(payload) / 1e6:.2f} MB)")
