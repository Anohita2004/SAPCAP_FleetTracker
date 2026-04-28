namespace tracker;
using { cuid, managed } from '@sap/cds/common';
entity Trips : cuid, managed {
  title     : String(120);
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
entity Vehicles : cuid, managed{
  vehicle_number : Integer;
  type : String;
  model : Integer;
  Registration_number : Integer;
  fuel_type : String(20) enum{
    PETROL;
    DIESEL;
  } default 'PETROL';
  status : String(20) enum{
    ACTIVE;
    DEACTIVATED;
  } default 'DEACTIVATED';
}