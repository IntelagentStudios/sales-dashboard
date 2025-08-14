import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Get all templates
router.get('/', async (req, res) => {
  try {
    const templates = await prisma.outreachTemplate.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get single template
router.get('/:id', async (req, res) => {
  try {
    const template = await prisma.outreachTemplate.findUnique({
      where: { id: req.params.id }
    });
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// Create new template
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description,
      productService,
      painPoints,
      valueProps,
      callToAction,
      pricing,
      successStories,
      tone,
      emailDesign,
      customHTML,
      emailExamples,
      brandColors,
      logo
    } = req.body;

    const template = await prisma.outreachTemplate.create({
      data: {
        name,
        description,
        productService,
        painPoints,
        valueProps,
        callToAction,
        pricing,
        successStories,
        tone,
        emailDesign,
        customHTML,
        emailExamples: emailExamples || [],
        brandColors,
        logo
      }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update template
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      description,
      productService,
      painPoints,
      valueProps,
      callToAction,
      pricing,
      successStories,
      tone,
      emailDesign,
      customHTML,
      emailExamples,
      brandColors,
      logo
    } = req.body;

    const template = await prisma.outreachTemplate.update({
      where: { id: req.params.id },
      data: {
        name,
        description,
        productService,
        painPoints,
        valueProps,
        callToAction,
        pricing,
        successStories,
        tone,
        emailDesign,
        customHTML,
        emailExamples,
        brandColors,
        logo
      }
    });

    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete template (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await prisma.outreachTemplate.update({
      where: { id: req.params.id },
      data: { active: false }
    });

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;