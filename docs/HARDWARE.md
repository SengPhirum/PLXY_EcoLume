# Reference hardware design

This is a functional reference, not an approved electrical design. A licensed electrical engineer and accredited laboratory must review the final PCB, enclosure, wiring, EMC, surge, thermal, and safety design.

## Proposed controller

| Component | Reference option | Purpose |
|---|---|---|
| MCU | ESP32-WROOM-32E or industrial equivalent | Secure application controller |
| LTE/GNSS | SIM7600 regional variant | Cellular data and positioning |
| LED control | Isolated DALI-2 or isolated 0–10 V module | On/off and dimming through certified driver |
| Metering | Isolated energy-metering IC/module | AC input voltage, current, power, energy |
| Temperature | Calibrated NTC or digital industrial sensor | Driver/controller thermal monitoring |
| Ambient light | BH1750 reference; industrial alternative for production | Day/night evidence and adaptive dimming |
| Tamper | Normally closed enclosure switch | Cabinet access alarm |
| Power | Certified isolated AC/DC supply with hold-up | Low-voltage controller supply |
| Protection | Fuse, MOV, TVS, GDT/SPD, filtering, earthing | Surge/lightning/transient protection |
| Enclosure | UV-resistant IP65/IP66 | Outdoor protection |

The INA219 in reference firmware is for safe low-voltage prototyping only. Do not place it on mains or on a high-voltage LED string.

## Cellular selection

Before choosing the exact SIM7600 part:

1. Obtain supported LTE bands and M2M/IoT APN options from Cambodian carriers.
2. Test urban, rural, and border locations across the target provinces.
3. Confirm static/private APN, VPN, SIM lifecycle, monthly quota, roaming policy, and SMS/data attack controls.
4. Select an outdoor-rated antenna with correct placement, grounding, and surge protection.
5. Size the supply for modem transmit-current peaks and cold-start behavior.

## Driver integration

DALI-2 is preferred when the luminaires support it because it offers standardized addressing and diagnostic data. Isolated 0–10 V can be used for simpler drivers. A relay/contactor should only switch power when rated for the LED driver's inrush current and required switching cycles.

## Prototype stages

1. Bench prototype at safe low voltage.
2. Isolated driver-interface prototype inside an electrical lab.
3. Environmental and surge test unit.
4. Ten-unit supervised road pilot.
5. Fifty-unit operational pilot with two carrier coverage profiles.
6. Design freeze after corrective actions and independent security/safety review.

## Data calibration

Store calibration coefficients per controller and record:

- reference instrument and calibration date;
- error at low, typical, and high load;
- temperature offset;
- GNSS accuracy distribution;
- modem RSSI/RSRP/RSRQ mapping;
- firmware and hardware revision.

