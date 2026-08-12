-- Data-only migration: reconcile opportunity_tags naming with the full ICP
-- spec's fuller phrasing, add the "Cloud Migration Opportunity" tag (a
-- genuine gap vs. the spec, not a duplicate of an existing tag), and rename
-- the score_weights "Leadership" component to "Leadership & Contact
-- Availability" per the spec's Stage 4. No DDL change — eip_schema.sql is
-- never hand-edited; this is an additive migration file.

UPDATE opportunity_tags SET tag_name = 'High Revenue Enterprise' WHERE tag_name = 'High Revenue';
UPDATE opportunity_tags SET tag_name = 'High IT Investor' WHERE tag_name = 'High IT Spend';
UPDATE opportunity_tags SET tag_name = 'High Cloud Adopter' WHERE tag_name = 'Cloud Adopter';
UPDATE opportunity_tags SET tag_name = 'Government Owned' WHERE tag_name = 'Government';
UPDATE opportunity_tags SET tag_name = 'Private Enterprise' WHERE tag_name = 'Private';
UPDATE opportunity_tags SET tag_name = 'Listed Entity' WHERE tag_name = 'Listed';
UPDATE opportunity_tags SET tag_name = 'Digital Transformation Opportunity' WHERE tag_name = 'Digital Transformation';
UPDATE opportunity_tags SET tag_name = 'Multi-Branch Enterprise' WHERE tag_name = 'Multi Branch';

INSERT INTO opportunity_tags (tag_name)
SELECT 'Cloud Migration Opportunity'
WHERE NOT EXISTS (SELECT 1 FROM opportunity_tags WHERE tag_name = 'Cloud Migration Opportunity');

UPDATE score_weights SET component_name = 'Leadership & Contact Availability' WHERE component_name = 'Leadership';
