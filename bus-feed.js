// A small reader for the GTFS-Realtime "Vehicles" feed (Protocol Buffers).
// It reads only the fields the bus map needs, so no protobuf library is bundled.
const decoder = new TextDecoder();

function* fields(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const varint = () => {
    let result = 0;
    for (let shift = 0; ; shift += 7) {
      if (offset >= bytes.length) throw new Error('Truncated feed.');
      const byte = bytes[offset++];
      result += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return result;
    }
  };
  while (offset < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) yield { field, wire, value: varint() };
    else if (wire === 1) { yield { field, wire, value: view.getFloat64(offset, true) }; offset += 8; }
    else if (wire === 5) { yield { field, wire, value: view.getFloat32(offset, true) }; offset += 4; }
    else if (wire === 2) {
      const length = varint();
      if (offset + length > bytes.length) throw new Error('Truncated feed.');
      yield { field, wire, value: bytes.subarray(offset, offset + length) };
      offset += length;
    } else throw new Error('Unsupported feed encoding.');
  }
}

function readVehicle(bytes) {
  const bus = { id: '', route: '', trip: '', lat: null, lon: null, bearing: null, time: 0 };
  for (const { field, value } of fields(bytes)) {
    if (field === 1) {
      for (const trip of fields(value)) {
        if (trip.field === 1) bus.trip = decoder.decode(trip.value);
        if (trip.field === 5) bus.route = decoder.decode(trip.value);
      }
    } else if (field === 2) {
      for (const position of fields(value)) {
        if (position.field === 1) bus.lat = position.value;
        if (position.field === 2) bus.lon = position.value;
        if (position.field === 3) bus.bearing = position.value;
      }
    } else if (field === 5) bus.time = value;
    else if (field === 8) {
      for (const vehicle of fields(value)) if (vehicle.field === 1) bus.id = decoder.decode(vehicle.value);
    }
  }
  return bus;
}

// Returns every vehicle that has a position, rounded for a small response.
export function parseVehicles(buffer) {
  const buses = [];
  for (const { field, value } of fields(new Uint8Array(buffer))) {
    if (field !== 2) continue;
    let id = '';
    let vehicle = null;
    for (const part of fields(value)) {
      if (part.field === 1) id = decoder.decode(part.value);
      if (part.field === 4) vehicle = readVehicle(part.value);
    }
    if (!vehicle || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
    buses.push({
      id: vehicle.id || id,
      route: vehicle.route,
      lat: Math.round(vehicle.lat * 1e5) / 1e5,
      lon: Math.round(vehicle.lon * 1e5) / 1e5,
      bearing: Number.isFinite(vehicle.bearing) ? Math.round(vehicle.bearing) : null,
      time: vehicle.time,
    });
  }
  return buses;
}
