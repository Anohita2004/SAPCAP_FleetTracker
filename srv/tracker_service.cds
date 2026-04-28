//Imports the database model
using tracker from '../db/schema';
//wxposes an API at /tracker
service TrackerService @(path : '/tracker') {
  entity Trips as projection on tracker.Trips;
  entity LocationPoints as projection on tracker.LocationPoints;

  action startTrip(title : String) returns Trips;
  action stopTrip(tripId : UUID) returns Trips;
  action recordLocation(
    tripId      : UUID,
    latitude    : Decimal(9, 6),
    longitude   : Decimal(9, 6),
    accuracy    : Decimal(9, 2),
    altitude    : Decimal(9, 2),
    speed       : Decimal(9, 2),
    heading     : Decimal(9, 2),
    recordedAt  : Timestamp,
    source      : String(30)
  ) returns LocationPoints;
  function activeTrip() returns Trips;
}