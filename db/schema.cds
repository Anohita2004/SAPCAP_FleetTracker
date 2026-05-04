namespace tracker;
using { cuid, managed } from '@sap/cds/common';
entity Admins : cuid, managed {
  name    : String(120);
  email   : String(255);
  drivers : Composition of many Drivers on drivers.admin = $self;
}
entity Drivers : cuid, managed {
  name   : String(120);
  email  : String(255);
  phone  : String(40);
  status : String(20) enum {
    ACTIVE;
    INACTIVE;
  } default 'ACTIVE';
  admin  : Association to Admins not null;
  trips  : Composition of many Trips on trips.driver = $self;
}
entity Trips : cuid, managed {
  title     : String(120);
  driver    : Association to Drivers;
  startedAt : Timestamp;
  endedAt   : Timestamp;
  status    : String(20) enum {
    ACTIVE;
    COMPLETED;
    PAUSED;
  } default 'ACTIVE';
  points    : Composition of many LocationPoints on points.trip = $self;
}
entity LocationPoints : cuid, managed {
  trip       : Association to Trips not null;
  latitude   : Decimal(9, 6);
  longitude  : Decimal(9, 6);
  accuracy   : Decimal(9, 2);
  altitude   : Decimal(9, 2);
  speed      : Decimal(9, 2);
  heading    : Decimal(9, 2);
  recordedAt : Timestamp;
  source     : String(30);
}
entity Vehicles : cuid, managed {
  vehicle_number      : Integer;
  type                : String;
  model               : Integer;
  Registration_number : Integer;
  fuel_type           : String(20) enum {
    PETROL;
    DIESEL;
  } default 'PETROL';
  status              : String(20) enum {
    ACTIVE;
    DEACTIVATED;
  } default 'DEACTIVATED';
}