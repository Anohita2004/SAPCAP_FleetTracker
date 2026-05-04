using tracker from '../db/schema';

@requires: 'authenticated-user'
service TrackerService @(path : '/tracker') {
  type UserContext {
    email    : String;
    name     : String;
    isAdmin  : Boolean;
    isDriver : Boolean;
    adminId  : UUID;
    driverId : UUID;
  }

  @restrict: [
    { grant: 'READ', to: 'FleetAdmin' },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'FleetAdmin' }
  ]
  entity Admins as projection on tracker.Admins;

  @restrict: [
    { grant: 'READ', to: ['Driver', 'FleetAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'FleetAdmin' }
  ]
  entity Drivers as projection on tracker.Drivers;

  @restrict: [
    { grant: 'READ', to: ['Driver', 'FleetAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'FleetAdmin' }
  ]
  entity Trips as projection on tracker.Trips;

  @restrict: [
    { grant: 'READ', to: ['Driver', 'FleetAdmin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'FleetAdmin' }
  ]
  entity LocationPoints as projection on tracker.LocationPoints;

  @restrict: [
    { grant: '*', to: 'FleetAdmin' }
  ]
  entity Vehicles as projection on tracker.Vehicles;

  function me() returns UserContext;

  @requires: 'FleetAdmin'
  action createDriver(
    name  : String,
    email : String,
    phone : String
  ) returns Drivers;

  @requires: 'Driver'
  action startTrip(title : String) returns Trips;

  @requires: 'Driver'
  action stopTrip(tripId : UUID) returns Trips;

  @requires: 'Driver'
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

  @requires: 'Driver'
  function activeTrip() returns Trips;
}
